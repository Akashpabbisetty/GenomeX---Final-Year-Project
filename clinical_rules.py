"""
clinical_rules.py
=================================================================
The hard clinical-guideline "safety floor" layered on top of the
multi-modal model's continuous risk score. This is intentional, not
a shortcut: real pharmacogenomic decision-support systems don't let
a statistical model override an absolute CPIC/FDA contraindication
(e.g. HLA-B*57:01 + abacavir) -- the model grades severity and
confidence for everything else, but a small set of hard rules acts
as a non-negotiable floor.

drug_rules.json is generated directly from the frontend's DRUGS
catalog (genomx-advisor.html / app.js), so the two stay in sync --
the same gene/allergy/severity assignments a clinician sees in the
UI are what the backend enforces as the floor.
=================================================================
"""

import json
import os

SEV_RANK = {"safe": 0, "monitor": 1, "adjust": 2, "risk": 3}
SEV_LABEL = {"safe": "Safe", "monitor": "Monitor", "adjust": "Dose adjustment", "risk": "Contraindicated"}

_RULES_PATH = os.path.join(os.path.dirname(__file__), "drug_rules.json")
with open(_RULES_PATH) as f:
    DRUG_RULES = {r["name"]: r for r in json.load(f)}


def evaluate_clinical_rules(drug_name: str, patient: dict) -> list:
    """Mirrors evaluateClinicalRules() in app.js exactly: renal/hepatic/
    pregnancy/age/drug-interaction checks, each returning a (severity,
    reason) flag. `patient` is expected to have keys: renal, hepatic,
    pregnant (bool), age (int|None), current_meds (lowercased str)."""
    rule = DRUG_RULES.get(drug_name, {})
    flags = []

    if rule.get("renalCaution") and patient.get("renal") == "impaired":
        severity = "risk" if drug_name == "Metformin" else "adjust"
        flags.append({"severity": severity,
                       "reason": f"Renal impairment noted — {drug_name} accumulates in reduced kidney function, raising toxicity risk."})

    if rule.get("hepaticCaution") and patient.get("hepatic") == "impaired":
        flags.append({"severity": "monitor",
                       "reason": f"Hepatic impairment noted — {drug_name} is hepatically metabolized; monitor liver enzymes closely."})

    if rule.get("pregnancyRisk") and patient.get("pregnant"):
        flags.append({"severity": "risk",
                       "reason": f"Patient is pregnant — {drug_name} carries known fetal/pregnancy risk and should be avoided where alternatives exist."})

    age = patient.get("age")
    if rule.get("pediatricRisk") and age is not None and age < 18:
        flags.append({"severity": "risk",
                       "reason": f"Patient is under 18 — {drug_name} carries an FDA boxed warning against use in children due to unpredictable opioid conversion."})

    current_meds = (patient.get("current_meds") or "").lower()
    if current_meds:
        if "warfarin" in current_meds and drug_name in ("Ibuprofen", "Aspirin", "Clopidogrel"):
            flags.append({"severity": "adjust",
                           "reason": f"Current warfarin therapy noted — combining with {drug_name} increases bleeding risk; monitor INR/clinical signs closely."})
        if "warfarin" in current_meds and drug_name in ("Amoxicillin", "Cephalexin"):
            flags.append({"severity": "monitor",
                           "reason": f"Current warfarin therapy noted — {drug_name} can transiently potentiate anticoagulant effect; monitor INR."})

    return flags


def gene_allergy_floor(drug_name: str, checked_genes: set, checked_allergies: set, gene_code_map: dict, allergy_code_map: dict):
    """The hard CPIC/allergy floor: if the patient carries the drug's
    linked risk gene or documented allergy, that gene/allergy's assigned
    severity is a non-negotiable minimum, regardless of what the model
    score says. Returns (severity_or_None, reason_or_None)."""
    rule = DRUG_RULES.get(drug_name, {})
    gene = rule.get("gene")
    allergy = rule.get("allergy")

    if gene and gene in checked_genes:
        sev = rule.get("geneSeverity") or "risk"
        code = gene_code_map.get(gene, gene)
        return sev, f"Patient carries {code}, a documented CPIC-guideline risk marker for this drug."
    if allergy and allergy in checked_allergies:
        sev = rule.get("allergySeverity") or "risk"
        code = allergy_code_map.get(allergy, allergy)
        return sev, f"Documented {code} allergy is a direct contraindication for this drug."
    return None, None


def combine_severity(*severities):
    """Highest-ranked severity wins (safe < monitor < adjust < risk)."""
    ranked = [s for s in severities if s]
    if not ranked:
        return "safe"
    return max(ranked, key=lambda s: SEV_RANK.get(s, 0))


# =================================================================
# Drug-drug interaction engine
# -----------------------------------------------------------------
# Current medications were being collected from the patient form but
# never actually analyzed -- only two hardcoded warfarin special cases
# existed. This replaces that with a real interaction knowledge base:
# for each of the 30 catalog drugs, a list of other medications
# (catalog drugs and common real-world comedications alike) known to
# interact with it, each with a real severity, mechanism, clinical
# effect, and management note. Checked as substring matches against
# the patient's free-text current-medications field, since that's the
# only form the frontend collects it in -- a patient's med list is
# rarely a clean drug-name enum in real intake data either.
# =================================================================
INTERACTION_SEVERITY_POINTS = {"major": 30, "moderate": 15, "minor": 6}

DRUG_INTERACTIONS = {
    "Warfarin": [
        {"other": "Fluconazole", "severity": "major", "mechanism": "CYP2C9 inhibition slows warfarin clearance",
         "effect": "↑ INR, ↑ bleeding risk", "management": "Avoid if possible; if required, reduce warfarin dose and monitor INR closely"},
        {"other": "Amiodarone", "severity": "major", "mechanism": "CYP2C9 and CYP3A4 inhibition",
         "effect": "↑ INR, ↑ bleeding risk", "management": "Reduce warfarin dose ~30-50% and monitor INR closely"},
        {"other": "Clarithromycin", "severity": "major", "mechanism": "CYP3A4 inhibition",
         "effect": "↑ INR, ↑ bleeding risk", "management": "Monitor INR closely during and after therapy"},
        {"other": "Rifampin", "severity": "major", "mechanism": "Strong CYP450 induction accelerates warfarin clearance",
         "effect": "↓ INR, ↓ anticoagulant effect, clotting risk", "management": "Monitor INR closely; warfarin dose often needs substantial increase"},
        {"other": "Aspirin", "severity": "major", "mechanism": "Additive antiplatelet and anticoagulant effect",
         "effect": "↑ bleeding risk", "management": "Avoid unless specifically indicated; monitor for bleeding"},
        {"other": "Ibuprofen", "severity": "major", "mechanism": "GI mucosal injury plus antiplatelet effect, additive to anticoagulation",
         "effect": "↑ GI bleeding risk", "management": "Avoid; use acetaminophen for analgesia instead"},
        {"other": "Trimethoprim-Sulfamethoxazole", "severity": "major", "mechanism": "CYP2C9 inhibition and vitamin K antagonism",
         "effect": "↑ INR, ↑ bleeding risk", "management": "Avoid if possible; monitor INR closely if co-prescribed"},
        {"other": "Amoxicillin", "severity": "moderate", "mechanism": "Altered gut flora reduces vitamin K synthesis",
         "effect": "INR fluctuation", "management": "Monitor INR during and after antibiotic course"},
        {"other": "Cephalexin", "severity": "moderate", "mechanism": "Altered gut flora reduces vitamin K synthesis",
         "effect": "INR fluctuation", "management": "Monitor INR during and after antibiotic course"},
        {"other": "Carbamazepine", "severity": "moderate", "mechanism": "CYP450 induction accelerates warfarin clearance",
         "effect": "↓ INR, reduced anticoagulant effect", "management": "Monitor INR closely; dose adjustment often needed"},
        {"other": "Phenytoin", "severity": "moderate", "mechanism": "Bidirectional CYP2C9 competition",
         "effect": "Unpredictable INR changes in either direction", "management": "Monitor INR closely on initiation or discontinuation"},
    ],
    "Clopidogrel": [
        {"other": "Omeprazole", "severity": "major", "mechanism": "CYP2C19 inhibition reduces clopidogrel activation",
         "effect": "↓ antiplatelet effect, ↑ thrombotic/stent-occlusion risk", "management": "Use pantoprazole or an H2-blocker instead if acid suppression is needed"},
        {"other": "Voriconazole", "severity": "moderate", "mechanism": "CYP2C19 inhibition reduces clopidogrel activation",
         "effect": "↓ antiplatelet effect", "management": "Monitor for reduced antiplatelet effect; consider alternative antifungal"},
        {"other": "Aspirin", "severity": "moderate", "mechanism": "Additive antiplatelet effect",
         "effect": "↑ bleeding risk", "management": "Often intentionally co-prescribed short-term; monitor for bleeding"},
        {"other": "Warfarin", "severity": "major", "mechanism": "Additive antiplatelet and anticoagulant effect",
         "effect": "↑ bleeding risk", "management": "Avoid triple therapy unless specifically indicated; monitor closely"},
    ],
    "Simvastatin": [
        {"other": "Voriconazole", "severity": "major", "mechanism": "Strong CYP3A4 inhibition raises statin exposure",
         "effect": "↑ myopathy / rhabdomyolysis risk", "management": "Avoid combination; suspend statin during antifungal course"},
        {"other": "Amiodarone", "severity": "major", "mechanism": "CYP3A4 inhibition raises statin exposure",
         "effect": "↑ myopathy / rhabdomyolysis risk", "management": "Cap simvastatin at 20mg/day per FDA labeling, or switch statin"},
        {"other": "Clarithromycin", "severity": "major", "mechanism": "Strong CYP3A4 inhibition",
         "effect": "↑ myopathy / rhabdomyolysis risk", "management": "Suspend statin during antibiotic course"},
        {"other": "Fluconazole", "severity": "major", "mechanism": "CYP3A4 inhibition raises statin exposure",
         "effect": "↑ myopathy risk", "management": "Consider temporary statin suspension during antifungal course"},
    ],
    "Atorvastatin": [
        {"other": "Voriconazole", "severity": "major", "mechanism": "Strong CYP3A4 inhibition raises statin exposure",
         "effect": "↑ myopathy / rhabdomyolysis risk", "management": "Avoid combination; suspend statin during antifungal course"},
        {"other": "Clarithromycin", "severity": "moderate", "mechanism": "CYP3A4 inhibition",
         "effect": "↑ myopathy risk", "management": "Consider temporary statin suspension during antibiotic course"},
        {"other": "Amiodarone", "severity": "moderate", "mechanism": "CYP3A4 inhibition",
         "effect": "↑ myopathy risk", "management": "Monitor for muscle symptoms; consider dose reduction"},
    ],
    "Rosuvastatin": [
        {"other": "Fluconazole", "severity": "minor", "mechanism": "Minimal CYP3A4 dependence, mild interaction",
         "effect": "Slightly increased statin exposure", "management": "Routine monitoring usually sufficient"},
    ],
    "Azathioprine": [
        {"other": "Allopurinol", "severity": "major", "mechanism": "Xanthine oxidase inhibition blocks thiopurine breakdown",
         "effect": "Severe, potentially fatal myelosuppression", "management": "Reduce azathioprine dose by ~75% if co-administration is unavoidable"},
    ],
    "Tamoxifen": [
        {"other": "Fluoxetine", "severity": "major", "mechanism": "Strong CYP2D6 inhibition blocks activation to endoxifen",
         "effect": "↓ tamoxifen efficacy", "management": "Use an SSRI with minimal CYP2D6 inhibition (e.g. citalopram) instead"},
        {"other": "Paroxetine", "severity": "major", "mechanism": "Strong CYP2D6 inhibition blocks activation to endoxifen",
         "effect": "↓ tamoxifen efficacy", "management": "Use an SSRI with minimal CYP2D6 inhibition instead"},
    ],
    "Codeine": [
        {"other": "Fluoxetine", "severity": "moderate", "mechanism": "CYP2D6 inhibition blocks activation to morphine",
         "effect": "↓ analgesic efficacy", "management": "Consider a non-codeine analgesic"},
        {"other": "Alprazolam", "severity": "major", "mechanism": "Additive CNS and respiratory depression",
         "effect": "↑ risk of sedation and respiratory depression", "management": "Avoid combination where possible; if required, use lowest effective doses with monitoring"},
    ],
    "Ibuprofen": [
        {"other": "Warfarin", "severity": "major", "mechanism": "GI mucosal injury plus antiplatelet effect, additive to anticoagulation",
         "effect": "↑ GI bleeding risk", "management": "Avoid; use acetaminophen for analgesia instead"},
        {"other": "Lisinopril", "severity": "moderate", "mechanism": "Reduced renal prostaglandin synthesis blunts antihypertensive effect",
         "effect": "↓ blood pressure control, ↑ renal impairment risk", "management": "Monitor blood pressure and renal function; limit duration of NSAID use"},
    ],
    "Aspirin": [
        {"other": "Warfarin", "severity": "major", "mechanism": "Additive antiplatelet and anticoagulant effect",
         "effect": "↑ bleeding risk", "management": "Avoid unless specifically indicated; monitor for bleeding"},
    ],
    "Citalopram": [
        {"other": "Omeprazole", "severity": "moderate", "mechanism": "CYP2C19 inhibition raises citalopram exposure",
         "effect": "↑ QT-prolongation risk at higher exposure", "management": "Consider dose reduction or pantoprazole instead"},
        {"other": "Amiodarone", "severity": "major", "mechanism": "Additive QT prolongation",
         "effect": "↑ risk of Torsades de Pointes", "management": "Avoid combination where possible; ECG monitoring if required"},
        {"other": "Ondansetron", "severity": "moderate", "mechanism": "Additive QT prolongation",
         "effect": "↑ QT-prolongation risk", "management": "Use lowest effective doses; consider ECG monitoring"},
        {"other": "Warfarin", "severity": "moderate", "mechanism": "Impaired platelet serotonin uptake adds to anticoagulant effect",
         "effect": "↑ bleeding risk", "management": "Monitor for bleeding, especially at treatment initiation"},
    ],
    "Escitalopram": [
        {"other": "Omeprazole", "severity": "moderate", "mechanism": "CYP2C19 inhibition raises escitalopram exposure",
         "effect": "↑ QT-prolongation risk at higher exposure", "management": "Consider dose reduction or pantoprazole instead"},
        {"other": "Amiodarone", "severity": "major", "mechanism": "Additive QT prolongation",
         "effect": "↑ risk of Torsades de Pointes", "management": "Avoid combination where possible; ECG monitoring if required"},
    ],
    "Carbamazepine": [
        {"other": "Voriconazole", "severity": "major", "mechanism": "Strong CYP3A4 induction dramatically lowers voriconazole levels",
         "effect": "Voriconazole treatment failure", "management": "Combination is generally contraindicated; use an alternative antifungal"},
        {"other": "Warfarin", "severity": "moderate", "mechanism": "CYP450 induction accelerates warfarin clearance",
         "effect": "↓ INR, reduced anticoagulant effect", "management": "Monitor INR closely; dose adjustment often needed"},
    ],
    "Voriconazole": [
        {"other": "Carbamazepine", "severity": "major", "mechanism": "Strong CYP3A4 induction dramatically lowers voriconazole levels",
         "effect": "Voriconazole treatment failure", "management": "Combination is generally contraindicated; use an alternative antifungal"},
        {"other": "Rifampin", "severity": "major", "mechanism": "Strong CYP3A4 induction",
         "effect": "Voriconazole treatment failure", "management": "Combination is contraindicated"},
        {"other": "Simvastatin", "severity": "major", "mechanism": "Strong CYP3A4 inhibition raises statin exposure",
         "effect": "↑ myopathy / rhabdomyolysis risk in the statin", "management": "Suspend statin during antifungal course"},
        {"other": "Phenytoin", "severity": "moderate", "mechanism": "Bidirectional CYP2C9/CYP3A4 interaction",
         "effect": "Altered levels of both drugs", "management": "Monitor levels of both drugs; dose adjustment often needed"},
    ],
    "Omeprazole": [
        {"other": "Clopidogrel", "severity": "major", "mechanism": "CYP2C19 inhibition reduces clopidogrel activation",
         "effect": "↓ antiplatelet effect, ↑ thrombotic/stent-occlusion risk", "management": "Use pantoprazole or an H2-blocker instead"},
        {"other": "Citalopram", "severity": "moderate", "mechanism": "CYP2C19 inhibition raises citalopram exposure",
         "effect": "↑ QT-prolongation risk", "management": "Consider dose reduction or pantoprazole instead"},
    ],
    "Phenytoin": [
        {"other": "Warfarin", "severity": "moderate", "mechanism": "Bidirectional CYP2C9 competition",
         "effect": "Unpredictable INR changes in either direction", "management": "Monitor INR closely on initiation or discontinuation"},
        {"other": "Fluconazole", "severity": "moderate", "mechanism": "CYP2C9 inhibition raises phenytoin levels",
         "effect": "↑ phenytoin toxicity risk", "management": "Monitor phenytoin levels; reduce dose if needed"},
        {"other": "Voriconazole", "severity": "moderate", "mechanism": "Bidirectional CYP2C9/CYP3A4 interaction",
         "effect": "Altered levels of both drugs", "management": "Monitor levels of both drugs; dose adjustment often needed"},
    ],
}


def check_drug_interactions(drug_name: str, current_meds_text: str) -> list:
    """Substring-matches the patient's free-text current medications
    against the interaction table for this candidate drug. Returns a
    list of interaction dicts, each with the deduction points already
    attached, ready to fold into the score and to display as a
    dedicated interaction callout."""
    if not current_meds_text:
        return []
    meds_lower = current_meds_text.lower()
    hits = []
    for interaction in DRUG_INTERACTIONS.get(drug_name, []):
        if interaction["other"].lower() in meds_lower:
            hits.append({**interaction, "points": INTERACTION_SEVERITY_POINTS[interaction["severity"]]})
    return hits


# =================================================================
# Composite scoring engine
# -----------------------------------------------------------------
# Instead of treating each risk signal as an independent, separately
# displayed flag, every applicable factor deducts a weighted number of
# points from a 100-point starting safety score. The final score is
# what actually drives the severity band and recommendation -- so
# "why is this Contraindicated" always has a literal, itemized answer
# instead of just the single most severe flag.
# =================================================================
POINTS = {
    "gene": {"risk": 55, "adjust": 30, "monitor": 12},
    "allergy": {"risk": 55, "adjust": 28, "monitor": 12},
    "renal_metformin": 45,
    "renal_other": 22,
    "hepatic": 15,
    "pregnancy": 35,
    "pediatric": 40,
    "interaction_bleed": 18,
    "interaction_inr": 10,
    "model_residual_max": 20,
}

# Diagnosis-text keyword -> contraindication, checked against the
# patient's free-text diagnosis field.
# =================================================================
# Diagnosis-based filtering engine (tiered, per-drug)
# -----------------------------------------------------------------
# Covers all 30 catalog drugs across cardiology, oncology,
# psychiatry, GI, infectious disease, and renal/hepatic disease.
# Three severity levels: risk (35pts) / adjust (20pts) / monitor (10pts)
# =================================================================

DIAGNOSIS_SEVERITY_POINTS = {"risk": 35, "adjust": 20, "monitor": 10}

DIAGNOSIS_RULES = {
    "Ibuprofen": [
        {"keywords": ["hypertension", "htn", "high blood pressure"],
         "severity": "adjust", "label": "Hypertension",
         "detail": "NSAIDs reduce antihypertensive efficacy and promote sodium/water retention, worsening blood pressure control"},
        {"keywords": ["heart failure", "chf", "cardiac failure", "decompensated"],
         "severity": "risk", "label": "Heart failure",
         "detail": "NSAIDs cause fluid retention and reduce renal prostaglandin synthesis, precipitating acute heart failure decompensation"},
        {"keywords": ["ulcer", "gi bleed", "gastrointestinal bleed", "peptic"],
         "severity": "risk", "label": "Active peptic ulcer / GI bleed",
         "detail": "NSAIDs directly damage the gastric mucosa and inhibit prostaglandin-mediated mucosal protection"},
        {"keywords": ["chronic kidney", "ckd", "renal disease"],
         "severity": "adjust", "label": "Chronic kidney disease",
         "detail": "NSAIDs reduce renal prostaglandin synthesis, reducing GFR and accelerating CKD progression"},
        {"keywords": ["asthma", "aspirin-sensitive", "nsaid-sensitive"],
         "severity": "risk", "label": "Asthma / NSAID-sensitive respiratory disease",
         "detail": "NSAIDs trigger bronchospasm in aspirin-exacerbated respiratory disease — affects ~10% of asthmatic patients"},
        {"keywords": ["atrial fibrillation", "afib", "anticoagul"],
         "severity": "adjust", "label": "Atrial fibrillation / anticoagulation",
         "detail": "NSAIDs increase bleeding risk in patients already on anticoagulant therapy for AF"},
    ],
    "Aspirin": [
        {"keywords": ["gout", "hyperuricemia", "uric acid"],
         "severity": "monitor", "label": "Gout / hyperuricemia",
         "detail": "Low-dose aspirin reduces renal urate excretion, raising serum uric acid and risking gout flares"},
        {"keywords": ["ulcer", "gi bleed", "gastrointestinal bleed", "peptic"],
         "severity": "adjust", "label": "Active peptic ulcer / GI bleed",
         "detail": "Aspirin directly damages the gastric mucosa even at low antiplatelet doses"},
        {"keywords": ["asthma", "nsaid-sensitive"],
         "severity": "adjust", "label": "Asthma / NSAID-sensitive respiratory disease",
         "detail": "Aspirin can trigger bronchospasm in aspirin-exacerbated respiratory disease"},
        {"keywords": ["heart failure", "chf"],
         "severity": "monitor", "label": "Heart failure",
         "detail": "Aspirin at higher doses may worsen heart failure through prostaglandin inhibition; assess benefit vs. risk"},
    ],
    "Warfarin": [
        {"keywords": ["bleeding disorder", "hemophilia", "haemophilia"],
         "severity": "risk", "label": "Known bleeding disorder",
         "detail": "Anticoagulation is contraindicated in the presence of an active, uncontrolled bleeding disorder"},
        {"keywords": ["hypertension", "uncontrolled bp", "htn"],
         "severity": "monitor", "label": "Uncontrolled hypertension",
         "detail": "Severely uncontrolled blood pressure increases intracranial bleeding risk during anticoagulation"},
        {"keywords": ["liver", "hepatic", "cirrhosis", "hepatitis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Hepatic disease reduces synthesis of vitamin K-dependent clotting factors, amplifying warfarin effect unpredictably"},
        {"keywords": ["stroke", "intracranial", "brain bleed"],
         "severity": "adjust", "label": "Recent intracranial event",
         "detail": "Recent intracranial haemorrhage is a relative contraindication; benefit-risk assessment required"},
    ],
    "Clopidogrel": [
        {"keywords": ["ulcer", "gi bleed", "gastrointestinal bleed", "peptic"],
         "severity": "adjust", "label": "Active GI bleed history",
         "detail": "Clopidogrel adds antiplatelet effect on top of an already compromised mucosal barrier"},
        {"keywords": ["bleeding disorder", "hemophilia"],
         "severity": "risk", "label": "Known bleeding disorder",
         "detail": "Antiplatelet therapy is contraindicated in active, uncontrolled bleeding disorders"},
    ],
    "Metformin": [
        {"keywords": ["heart failure", "chf", "cardiac failure", "decompensated"],
         "severity": "risk", "label": "Decompensated heart failure",
         "detail": "Reduced cardiac output causes tissue hypoxia; metformin accumulation leads to lactic acidosis"},
        {"keywords": ["liver", "hepatic", "cirrhosis", "hepatitis"],
         "severity": "risk", "label": "Significant hepatic impairment",
         "detail": "Hepatic clearance of lactate is impaired, greatly raising lactic acidosis risk with metformin"},
        {"keywords": ["imaging", "contrast", "iodinated", "dye"],
         "severity": "adjust", "label": "Iodinated contrast procedure",
         "detail": "Withhold metformin 48h before and after iodinated contrast to prevent contrast-induced nephropathy + lactic acidosis"},
    ],
    "Carbamazepine": [
        {"keywords": ["bone marrow", "blood dyscrasia", "aplastic"],
         "severity": "risk", "label": "Bone marrow suppression / blood dyscrasia",
         "detail": "Carbamazepine can cause aplastic anaemia; contraindicated in pre-existing bone marrow depression"},
        {"keywords": ["hyponatremia", "sodium", "siadh"],
         "severity": "adjust", "label": "Hyponatraemia / SIADH",
         "detail": "Carbamazepine stimulates ADH release, worsening existing hyponatraemia"},
        {"keywords": ["liver", "hepatic", "cirrhosis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Carbamazepine is hepatically metabolised; hepatic impairment raises drug and toxic metabolite exposure"},
        {"keywords": ["atrial fibrillation", "afib", "heart block", "av block", "cardiac conduction"],
         "severity": "adjust", "label": "Cardiac conduction disorder",
         "detail": "Carbamazepine can slow cardiac conduction; use with caution in pre-existing AV block"},
    ],
    "Oxcarbazepine": [
        {"keywords": ["hyponatremia", "sodium", "siadh"],
         "severity": "adjust", "label": "Hyponatraemia / SIADH",
         "detail": "Oxcarbazepine causes clinically significant hyponatraemia in ~2-3% of patients, higher risk if pre-existing"},
        {"keywords": ["liver", "hepatic", "cirrhosis"],
         "severity": "monitor", "label": "Hepatic disease",
         "detail": "Oxcarbazepine requires hepatic metabolism; monitor levels and tolerability in hepatic impairment"},
    ],
    "Phenytoin": [
        {"keywords": ["liver", "hepatic", "cirrhosis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Phenytoin is extensively hepatically metabolised; saturable kinetics mean small dose changes cause large level swings"},
        {"keywords": ["depression", "depressive", "mdd"],
         "severity": "monitor", "label": "Depression",
         "detail": "Phenytoin can exacerbate depressive symptoms; monitor mental health closely during treatment"},
    ],
    "Citalopram": [
        {"keywords": ["atrial fibrillation", "afib", "qt", "long qt", "torsades", "cardiac arrhythmia"],
         "severity": "adjust", "label": "Atrial fibrillation / QT disorder",
         "detail": "Citalopram causes dose-dependent QT prolongation; pre-existing AF or QT disorder raises arrhythmia risk"},
        {"keywords": ["bipolar", "mania", "manic"],
         "severity": "adjust", "label": "Bipolar disorder",
         "detail": "SSRIs can trigger manic episodes in bipolar disorder without adequate mood stabiliser cover"},
        {"keywords": ["epilepsy", "seizure"],
         "severity": "monitor", "label": "Epilepsy",
         "detail": "SSRIs can lower the seizure threshold at higher doses; monitor seizure frequency"},
        {"keywords": ["liver", "hepatic", "cirrhosis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Citalopram clearance is reduced in hepatic impairment; use half the maximum dose"},
    ],
    "Escitalopram": [
        {"keywords": ["atrial fibrillation", "afib", "qt", "long qt", "torsades"],
         "severity": "adjust", "label": "Atrial fibrillation / QT disorder",
         "detail": "Escitalopram causes dose-dependent QT prolongation; pre-existing AF or QT disorder raises arrhythmia risk"},
        {"keywords": ["bipolar", "mania", "manic"],
         "severity": "adjust", "label": "Bipolar disorder",
         "detail": "SSRIs can trigger manic episodes in bipolar disorder without adequate mood stabiliser cover"},
        {"keywords": ["liver", "hepatic", "cirrhosis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Escitalopram clearance is reduced in hepatic impairment; use half the maximum dose"},
    ],
    "Amitriptyline": [
        {"keywords": ["atrial fibrillation", "afib", "heart block", "cardiac arrhythmia", "av block"],
         "severity": "risk", "label": "Cardiac conduction disorder / arrhythmia",
         "detail": "Tricyclic antidepressants block cardiac fast sodium channels; pre-existing conduction disease risks fatal arrhythmia"},
        {"keywords": ["glaucoma", "angle-closure"],
         "severity": "risk", "label": "Angle-closure glaucoma",
         "detail": "Anticholinergic effect precipitates acute angle-closure glaucoma attacks"},
        {"keywords": ["hypertension", "htn", "high blood pressure"],
         "severity": "monitor", "label": "Hypertension",
         "detail": "Tricyclics can cause orthostatic hypotension and unpredictable BP changes, complicating hypertension management"},
        {"keywords": ["bipolar", "mania", "manic"],
         "severity": "adjust", "label": "Bipolar disorder",
         "detail": "Tricyclics can trigger manic switches in bipolar disorder"},
        {"keywords": ["epilepsy", "seizure"],
         "severity": "adjust", "label": "Epilepsy",
         "detail": "Tricyclics lower seizure threshold; use with caution and only if seizures are well-controlled"},
    ],
    "Atomoxetine": [
        {"keywords": ["hypertension", "htn", "high blood pressure"],
         "severity": "adjust", "label": "Hypertension",
         "detail": "Atomoxetine raises heart rate and blood pressure; pre-existing hypertension requires monitoring and may need antihypertensive adjustment"},
        {"keywords": ["atrial fibrillation", "afib", "cardiac arrhythmia"],
         "severity": "adjust", "label": "Cardiac arrhythmia",
         "detail": "Atomoxetine's sympathomimetic effect can worsen existing cardiac arrhythmias"},
        {"keywords": ["liver", "hepatic", "cirrhosis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Atomoxetine is hepatically metabolised; hepatic impairment substantially raises drug exposure"},
        {"keywords": ["glaucoma", "angle-closure"],
         "severity": "adjust", "label": "Angle-closure glaucoma",
         "detail": "Mydriatic effect can trigger acute angle-closure episodes"},
    ],
    "Ondansetron": [
        {"keywords": ["atrial fibrillation", "afib", "qt", "long qt", "torsades", "cardiac arrhythmia"],
         "severity": "adjust", "label": "Atrial fibrillation / QT disorder",
         "detail": "Ondansetron prolongs the QT interval; risk is higher in pre-existing QT disorders and with other QT-prolonging drugs"},
        {"keywords": ["hypokalemia", "low potassium", "electrolyte"],
         "severity": "monitor", "label": "Hypokalaemia",
         "detail": "Ondansetron's QT-prolonging effect is amplified by electrolyte imbalance, particularly low potassium"},
    ],
    "Omeprazole": [
        {"keywords": ["osteoporosis", "fracture", "low bone density"],
         "severity": "monitor", "label": "Osteoporosis",
         "detail": "Long-term PPI use reduces gastric acid-dependent calcium absorption, worsening bone density"},
        {"keywords": ["hypomagnesemia", "low magnesium", "magnesium deficiency"],
         "severity": "adjust", "label": "Hypomagnesaemia",
         "detail": "Long-term PPI use causes clinically significant hypomagnesaemia; can worsen pre-existing deficiency"},
    ],
    "Simvastatin": [
        {"keywords": ["hypothyroid", "hypothyroidism", "underactive thyroid"],
         "severity": "adjust", "label": "Hypothyroidism",
         "detail": "Untreated hypothyroidism raises statin exposure and independently causes myopathy; treat thyroid disorder before or alongside statin initiation"},
        {"keywords": ["liver", "hepatic", "cirrhosis", "hepatitis"],
         "severity": "risk", "label": "Active hepatic disease",
         "detail": "Active hepatic disease or persistently elevated transaminases are contraindications for statin use"},
        {"keywords": ["myopathy", "rhabdomyolysis", "muscle disease", "myositis"],
         "severity": "risk", "label": "Pre-existing myopathy",
         "detail": "Pre-existing muscle disease substantially raises the risk of severe statin-induced myopathy"},
    ],
    "Atorvastatin": [
        {"keywords": ["hypothyroid", "hypothyroidism", "underactive thyroid"],
         "severity": "adjust", "label": "Hypothyroidism",
         "detail": "Untreated hypothyroidism raises statin exposure and independently causes myopathy; treat thyroid disorder before or alongside statin initiation"},
        {"keywords": ["liver", "hepatic", "cirrhosis", "hepatitis"],
         "severity": "risk", "label": "Active hepatic disease",
         "detail": "Active hepatic disease or persistently elevated transaminases are contraindications for statin use"},
        {"keywords": ["myopathy", "rhabdomyolysis", "muscle disease"],
         "severity": "risk", "label": "Pre-existing myopathy",
         "detail": "Pre-existing muscle disease substantially raises the risk of severe statin-induced myopathy"},
    ],
    "Rosuvastatin": [
        {"keywords": ["liver", "hepatic", "cirrhosis", "hepatitis"],
         "severity": "risk", "label": "Active hepatic disease",
         "detail": "Active hepatic disease or persistently elevated transaminases are contraindications for statin use"},
        {"keywords": ["hypothyroid", "hypothyroidism"],
         "severity": "adjust", "label": "Hypothyroidism",
         "detail": "Untreated hypothyroidism raises myopathy risk with statins; address thyroid disorder first"},
    ],
    "Fluorouracil (5-FU)": [
        {"keywords": ["heart failure", "chf", "ischemic", "coronary", "angina", "cardiac"],
         "severity": "adjust", "label": "Cardiac disease",
         "detail": "Fluorouracil causes cardiotoxicity (coronary vasospasm, arrhythmia) in ~7% of patients; pre-existing cardiac disease amplifies this risk"},
    ],
    "Capecitabine": [
        {"keywords": ["heart failure", "chf", "ischemic", "coronary", "angina", "cardiac"],
         "severity": "adjust", "label": "Cardiac disease",
         "detail": "Capecitabine (oral 5-FU prodrug) carries the same cardiotoxicity risk as 5-FU; use with caution in pre-existing cardiac disease"},
        {"keywords": ["chronic kidney", "ckd", "renal impairment"],
         "severity": "adjust", "label": "Renal impairment",
         "detail": "Capecitabine requires dose reduction in moderate renal impairment; contraindicated below eGFR 30"},
    ],
    "Irinotecan": [
        {"keywords": ["liver", "hepatic", "cirrhosis", "bilirubin"],
         "severity": "adjust", "label": "Hepatic impairment / raised bilirubin",
         "detail": "Irinotecan's active metabolite SN-38 is cleared hepatically; hepatic impairment raises SN-38 toxicity substantially"},
        {"keywords": ["inflammatory bowel", "ibd", "crohn", "colitis"],
         "severity": "adjust", "label": "Inflammatory bowel disease",
         "detail": "Irinotecan diarrhoea is severe and life-threatening; pre-existing IBD dramatically worsens this risk"},
    ],
    "Azathioprine": [
        {"keywords": ["active infection", "sepsis", "serious infection"],
         "severity": "risk", "label": "Active infection",
         "detail": "Azathioprine's immunosuppressive effect prevents adequate immune response to active infections"},
        {"keywords": ["cancer", "lymphoma", "malignancy"],
         "severity": "monitor", "label": "Pre-existing malignancy",
         "detail": "Long-term azathioprine use increases the risk of lymphoma and skin cancers; in pre-existing malignancy, specialist risk-benefit assessment is required"},
    ],
    "Tamoxifen": [
        {"keywords": ["dvt", "pulmonary embolism", "thromboembolism", "clot", "thrombosis"],
         "severity": "adjust", "label": "Thromboembolic history",
         "detail": "Tamoxifen increases the risk of DVT and pulmonary embolism; prior thromboembolism requires individual specialist risk-benefit assessment"},
        {"keywords": ["endometrial", "uterine cancer"],
         "severity": "adjust", "label": "Endometrial cancer history",
         "detail": "Tamoxifen has weak oestrogen-agonist effects on the endometrium; prior or current endometrial cancer is a relative contraindication"},
    ],
    "Amoxicillin": [
        {"keywords": ["glandular fever", "mononucleosis", "ebv", "epstein-barr"],
         "severity": "risk", "label": "Glandular fever / EBV infection",
         "detail": "Amoxicillin causes a widespread maculopapular rash in >90% of patients with active EBV / glandular fever; it must be avoided"},
    ],
    "Trimethoprim-Sulfamethoxazole": [
        {"keywords": ["g6pd", "glucose-6-phosphate"],
         "severity": "risk", "label": "G6PD deficiency",
         "detail": "Sulfonamides cause haemolytic anaemia in G6PD-deficient patients"},
        {"keywords": ["folate deficiency", "folic acid deficiency"],
         "severity": "adjust", "label": "Folate deficiency",
         "detail": "Trimethoprim inhibits dihydrofolate reductase, worsening pre-existing folate deficiency and risking megaloblastic anaemia"},
        {"keywords": ["chronic kidney", "ckd", "renal disease", "renal impairment"],
         "severity": "adjust", "label": "Chronic kidney disease",
         "detail": "TMP-SMX raises serum creatinine by blocking tubular secretion and raises potassium; monitoring is essential in CKD"},
    ],
    "Abacavir": [
        {"keywords": ["cardiovascular", "heart disease", "coronary", "cad", "myocardial infarction"],
         "severity": "monitor", "label": "Cardiovascular disease",
         "detail": "Some studies associate abacavir with a modestly increased risk of myocardial infarction; warrants monitoring in patients with high baseline CV risk"},
    ],
    "Allopurinol": [
        {"keywords": ["chronic kidney", "ckd", "renal impairment", "renal disease"],
         "severity": "adjust", "label": "Renal impairment",
         "detail": "Allopurinol and its active metabolite oxypurinol are renally cleared; dose reduction is required to prevent toxic accumulation"},
        {"keywords": ["acute gout", "active gout flare"],
         "severity": "monitor", "label": "Acute gout flare",
         "detail": "Starting allopurinol during an acute gout attack can prolong or worsen the flare; initiate during the inter-critical period instead"},
    ],
    "Codeine": [
        {"keywords": ["epilepsy", "seizure"],
         "severity": "monitor", "label": "Epilepsy",
         "detail": "High-dose opioids can lower seizure threshold; monitor seizure frequency if codeine is used in epileptic patients"},
        {"keywords": ["copd", "chronic obstructive", "respiratory failure", "type 2 respiratory"],
         "severity": "risk", "label": "COPD / respiratory failure",
         "detail": "Opioids cause respiratory depression; pre-existing CO2 retention or respiratory failure is a near-absolute contraindication"},
    ],
    "Voriconazole": [
        {"keywords": ["liver", "hepatic", "cirrhosis", "hepatitis"],
         "severity": "adjust", "label": "Hepatic disease",
         "detail": "Voriconazole is hepatically metabolised and hepatotoxic; hepatic disease substantially raises liver adverse event risk"},
    ],
    "Levothyroxine": [
        {"keywords": ["atrial fibrillation", "afib", "cardiac arrhythmia"],
         "severity": "monitor", "label": "Atrial fibrillation",
         "detail": "Over-replacement with levothyroxine triggers or worsens AF; TSH must be monitored closely"},
        {"keywords": ["angina", "ischemic heart", "coronary", "cad"],
         "severity": "monitor", "label": "Ischaemic heart disease",
         "detail": "Rapid correction of hypothyroidism increases myocardial oxygen demand; start at low dose and titrate slowly"},
    ],
}


def check_diagnosis_rules(drug_name: str, diagnosis_text: str) -> list:
    """Checks the patient's free-text diagnosis field against the tiered
    DIAGNOSIS_RULES table for this drug. Returns a list of matched rules
    with severity, label, detail, and point deduction computed."""
    if not diagnosis_text:
        return []
    diag_lower = diagnosis_text.lower()
    hits = []
    for rule in DIAGNOSIS_RULES.get(drug_name, []):
        if any(kw in diag_lower for kw in rule["keywords"]):
            pts = DIAGNOSIS_SEVERITY_POINTS[rule["severity"]]
            hits.append({
                "severity": rule["severity"], "label": rule["label"],
                "detail": rule["detail"], "points": pts,
            })
    return hits


RECOMMENDATION = {"risk": "Avoid", "adjust": "Use with dose adjustment", "monitor": "Use with monitoring", "safe": "Safe to use"}


def score_band(score: float) -> str:
    if score >= 80:
        return "safe"
    if score >= 60:
        return "monitor"
    if score >= 35:
        return "adjust"
    return "risk"


def compute_overall_score(drug_name: str, patient: dict, checked_genes: set, checked_allergies: set,
                           gene_code_map: dict, allergy_code_map: dict, model_score: float = None) -> dict:
    """Computes one overall 0-100 safety score for this drug + patient,
    combining genetic risk, drug allergy, kidney function, liver
    function, pregnancy, current medication interactions, age, disease
    contraindication, and (when available) the multi-modal model's
    residual risk signal -- all evaluated together, not independently.
    Returns the score, its severity band, a plain recommendation, and
    the itemized list of factors that actually contributed, each with
    its point deduction, so every score is traceable to specific,
    named reasons rather than a single opaque number."""
    rule = DRUG_RULES.get(drug_name, {})
    score = 100.0
    factors = []
    hard_floor = False  # true if a CPIC-grade genetic/allergy match must force "risk" regardless of arithmetic

    gene = rule.get("gene")
    if gene and gene in checked_genes:
        sev = rule.get("geneSeverity") or "risk"
        pts = POINTS["gene"][sev]
        score -= pts
        if sev == "risk":
            hard_floor = True
        code = gene_code_map.get(gene, gene)
        factors.append({"label": code, "points": -pts, "detail": "Documented CPIC-guideline genetic risk marker"})

    allergy = rule.get("allergy")
    if allergy and allergy in checked_allergies:
        sev = rule.get("allergySeverity") or "risk"
        pts = POINTS["allergy"][sev]
        score -= pts
        if sev == "risk":
            hard_floor = True
        code = allergy_code_map.get(allergy, allergy)
        factors.append({"label": f"{code} allergy", "points": -pts, "detail": "Documented allergy contraindication"})

    if rule.get("renalCaution") and patient.get("renal") == "impaired":
        is_metformin = drug_name == "Metformin"
        pts = POINTS["renal_metformin"] if is_metformin else POINTS["renal_other"]
        score -= pts
        if is_metformin:
            hard_floor = True
        factors.append({"label": "Kidney impairment", "points": -pts, "detail": f"{drug_name} accumulates in reduced kidney function"})

    if rule.get("hepaticCaution") and patient.get("hepatic") == "impaired":
        score -= POINTS["hepatic"]
        factors.append({"label": "Liver impairment", "points": -POINTS["hepatic"], "detail": f"{drug_name} is hepatically metabolized"})

    if rule.get("pregnancyRisk") and patient.get("pregnant"):
        score -= POINTS["pregnancy"]
        hard_floor = True
        factors.append({"label": "Pregnancy", "points": -POINTS["pregnancy"], "detail": f"{drug_name} carries known fetal/pregnancy risk"})

    age = patient.get("age")
    if rule.get("pediatricRisk") and age is not None and age < 18:
        score -= POINTS["pediatric"]
        hard_floor = True
        factors.append({"label": "Age under 18", "points": -POINTS["pediatric"], "detail": f"{drug_name} carries a pediatric boxed warning"})

    current_meds = (patient.get("current_meds") or "").lower()
    interaction_hits = check_drug_interactions(drug_name, patient.get("current_meds") or "")
    for hit in interaction_hits:
        score -= hit["points"]
        factors.append({
            "label": f"{hit['other']} (current medication)", "points": -hit["points"],
            "detail": f"{hit['severity'].capitalize()} interaction — {hit['mechanism']}. Effect: {hit['effect']}.",
        })

    diagnosis_hits = check_diagnosis_rules(drug_name, patient.get("diagnosis") or "")
    for dhit in diagnosis_hits:
        score -= dhit["points"]
        if dhit["severity"] == "risk":
            hard_floor = True
        factors.append({"label": dhit["label"], "points": -dhit["points"], "detail": dhit["detail"]})

    if model_score is not None:
        residual_pts = round(model_score * POINTS["model_residual_max"])
        if residual_pts > 0:
            score -= residual_pts
            if residual_pts >= 5:
                factors.append({"label": "Multi-modal model residual risk", "points": -residual_pts,
                                 "detail": "Learned risk signal (RF+XGBoost+CNN+Bi-LSTM+Fusion+GNN) beyond the hard rules above"})

    score = max(0, min(100, round(score)))
    severity = score_band(score)

    if hard_floor and severity != "risk":
        # A CPIC-grade absolute contraindication (or pregnancy/pediatric
        # boxed warning, or Metformin + renal failure) is non-negotiable:
        # it must always land in the "risk" band, regardless of how the
        # arithmetic total happens to fall. Clamp the displayed score to
        # match so the number and the recommendation never contradict
        # each other.
        severity = "risk"
        score = min(score, 34)

    if not factors:
        factors.append({"label": "No risk factors identified", "points": 0,
                         "detail": "No genetic, allergy, organ-function, pregnancy, age, interaction, or diagnosis flag matched this patient"})

    return {
        "overall_score": score, "severity": severity, "severity_label": SEV_LABEL[severity],
        "recommendation": RECOMMENDATION[severity], "factors": factors, "interactions": interaction_hits,
    }
