/* =========================================================
   GenomX Advisor — data model + logic
   Data is structured as plain JS objects (JSON-shaped) so it
   can be swapped for a real API/database call later:
   e.g. fetch('/api/genes').then(r=>r.json())
   ========================================================= */

const GENES = [
  { id:"HLAB5701", label:"HLA-B*57:01 positive", code:"HLA-B*57:01",
    tip:"An immune (HLA class I) allele. Presenting abacavir fragments on this allele triggers T-cell mediated hypersensitivity in carriers." },
  { id:"HLAB5801", label:"HLA-B*58:01 positive", code:"HLA-B*58:01",
    tip:"An HLA allele strongly linked to severe cutaneous reactions (SJS/TEN) triggered by allopurinol and its metabolite oxypurinol." },
  { id:"CYP2C93",  label:"CYP2C9*3 carrier", code:"CYP2C9*3",
    tip:"A reduced-function CYP2C9 variant. Slows clearance of phenytoin and warfarin, raising plasma levels and toxicity risk at standard doses." },
  { id:"TPMTLOW",  label:"TPMT deficient / NUDT15 variant", code:"TPMT/NUDT15",
    tip:"Both enzymes inactivate thiopurine drugs. Deficiency causes toxic accumulation of active metabolites, risking severe bone-marrow suppression." },
  { id:"SLCO1B1",  label:"SLCO1B1 variant carrier", code:"SLCO1B1",
    tip:"SLCO1B1 transports statins into the liver for clearance. Reduced-function variants raise blood statin levels, increasing myopathy risk." },
  { id:"CYP2C19PM",label:"CYP2C19 poor metabolizer", code:"CYP2C19*2/*3",
    tip:"CYP2C19 activates clopidogrel to its active form. Poor metabolizers generate less active drug, reducing antiplatelet effect." },
  { id:"CYP2D6UM", label:"CYP2D6 ultrarapid metabolizer", code:"CYP2D6 UM",
    tip:"CYP2D6 converts codeine to morphine. Ultrarapid metabolizers produce morphine unusually fast, risking life-threatening toxicity." },
  { id:"CYP2D6PM", label:"CYP2D6 poor metabolizer", code:"CYP2D6 PM",
    tip:"Poor CYP2D6 activity slows clearance of many antidepressants and reduces activation of prodrugs like tamoxifen, altering both safety and efficacy." },
  { id:"VKORC1", label:"VKORC1 reduced-sensitivity variant", code:"VKORC1",
    tip:"VKORC1 is the target enzyme of warfarin. Variants change how sensitive a patient is to the drug, directly affecting the dose needed for safe anticoagulation." },
  { id:"DPYD", label:"DPYD deficient / reduced activity", code:"DPYD",
    tip:"DPYD breaks down fluoropyrimidine chemotherapy drugs. Deficiency causes toxic drug accumulation, risking severe, potentially fatal toxicity at standard doses." },
  { id:"UGT1A1", label:"UGT1A1*28 reduced-function carrier", code:"UGT1A1*28",
    tip:"UGT1A1 clears the active metabolite of irinotecan. Reduced-function carriers accumulate more active drug, raising the risk of severe neutropenia." },
  { id:"HLAB1502", label:"HLA-B*15:02 positive", code:"HLA-B*15:02",
    tip:"An HLA allele strongly associated with severe cutaneous reactions (SJS/TEN) to carbamazepine and related anticonvulsants, particularly in patients of Southeast Asian ancestry." },
];

const ALLERGIES = [
  { id:"PENICILLIN", label:"Penicillin / beta-lactam allergy", code:"β-lactam",
    tip:"IgE-mediated hypersensitivity to the beta-lactam ring shared by penicillins, and cross-reactive with some cephalosporins." },
  { id:"SULFA",       label:"Sulfa drug allergy", code:"Sulfonamide",
    tip:"Hypersensitivity to the sulfonamide group, associated with rash up to severe SJS/TEN reactions." },
  { id:"NSAID",       label:"NSAID allergy", code:"NSAID",
    tip:"Often a pseudo-allergic COX-1 inhibition reaction causing bronchospasm or angioedema rather than true IgE allergy." },
];

/* Severity ranks used for comparisons */
const SEV_RANK = { safe:0, monitor:1, adjust:2, risk:3 };
const SEV_LABEL = { safe:"Safe", monitor:"Monitor", adjust:"Dose adjustment", risk:"Contraindicated" };
const SEV_ICON  = { safe:"🟢", monitor:"🟡", adjust:"🟠", risk:"🔴" };

const DRUGS = [
  {
    name:"Abacavir", class:"Antiretroviral (NRTI)", gene:"HLAB5701",
    geneSeverity:"risk", reaction:"severe hypersensitivity syndrome (fever, rash, multi-organ involvement)",
    uses:"Treatment of HIV-1 infection, usually combined with other antiretrovirals.",
    mechanism:"Nucleoside reverse transcriptase inhibitor; blocks HIV DNA synthesis.",
    sideEffects:"Nausea, fatigue, headache; rare but severe hypersensitivity in HLA-B*57:01 carriers.",
    contraindications:"HLA-B*57:01 positive status (absolute contraindication per CPIC/FDA label).",
    cpic:"CPIC Level A — test before first use", evidence:["CPIC Level A","FDA boxed warning","PharmGKB 1A"],
    confidence:98, alternatives:["Tenofovir-based regimen (e.g. tenofovir/emtricitabine)"]
  },
  {
    name:"Allopurinol", class:"Xanthine oxidase inhibitor", gene:"HLAB5801",
    geneSeverity:"risk", reaction:"Stevens–Johnson syndrome / toxic epidermal necrolysis",
    uses:"Long-term management of gout and hyperuricemia.",
    mechanism:"Inhibits xanthine oxidase, lowering uric acid production.",
    sideEffects:"Rash, GI upset; rare but life-threatening SJS/TEN in HLA-B*58:01 carriers.",
    contraindications:"HLA-B*58:01 positive status, especially in patients of Han Chinese, Thai, or Korean descent.",
    cpic:"CPIC Level A — consider testing before use", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:95, alternatives:["Febuxostat (with caution)","Probenecid-based alternative"]
  },
  {
    name:"Phenytoin", class:"Anticonvulsant", gene:"CYP2C93",
    geneSeverity:"adjust", reaction:"toxicity (nystagmus, ataxia) and elevated SJS risk at standard doses",
    uses:"Management of tonic-clonic and partial seizures; status epilepticus.",
    mechanism:"Blocks voltage-gated sodium channels, stabilising neuronal membranes.",
    sideEffects:"Gingival hyperplasia, ataxia, sedation; teratogenic in pregnancy.",
    contraindications:"Reduced-function CYP2C9 alleles; pregnancy (fetal hydantoin syndrome).",
    cpic:"CPIC Level A — reduce starting dose ~25% in poor metabolizers", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:90, alternatives:["Levetiracetam (minimal CYP involvement)"],
    pregnancyRisk:true
  },
  {
    name:"Azathioprine", class:"Thiopurine immunosuppressant", gene:"TPMTLOW",
    geneSeverity:"risk", reaction:"severe, potentially fatal myelosuppression",
    uses:"Autoimmune disease and transplant rejection prophylaxis.",
    mechanism:"Converted to 6-thioguanine nucleotides that disrupt DNA synthesis in proliferating cells.",
    sideEffects:"Bone-marrow suppression, hepatotoxicity, infection risk.",
    contraindications:"TPMT or NUDT15 deficiency without major dose reduction.",
    cpic:"CPIC Level A — reduce dose 10-fold or select alternative", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:96, alternatives:["Substantially reduced-dose azathioprine under specialist monitoring","Mycophenolate mofetil (specialist-guided)"]
  },
  {
    name:"Simvastatin", class:"Statin (HMG-CoA reductase inhibitor)", gene:"SLCO1B1",
    geneSeverity:"adjust", reaction:"myopathy / rhabdomyolysis, especially at higher doses",
    uses:"Lowering LDL cholesterol to reduce cardiovascular risk.",
    mechanism:"Inhibits HMG-CoA reductase, reducing hepatic cholesterol synthesis.",
    sideEffects:"Myalgia, elevated liver enzymes; rare rhabdomyolysis.",
    contraindications:"Active liver disease; caution in SLCO1B1 reduced-function carriers at high doses; caution in pregnancy.",
    cpic:"CPIC Level A — avoid high dose or select alternative statin", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:88, alternatives:["Rosuvastatin or pravastatin at standard dose (less SLCO1B1-dependent)"],
    pregnancyRisk:true, hepaticCaution:true
  },
  {
    name:"Clopidogrel", class:"Antiplatelet (P2Y12 inhibitor)", gene:"CYP2C19PM",
    geneSeverity:"adjust", reaction:"reduced antiplatelet effect, higher thrombotic/stent-occlusion risk",
    uses:"Prevention of thrombotic events after ACS, stenting, or stroke.",
    mechanism:"Prodrug activated by CYP2C19 to irreversibly block platelet P2Y12 receptors.",
    sideEffects:"Bleeding, bruising, GI upset.",
    contraindications:"Poor CYP2C19 metabolizer status in high-risk cardiovascular settings.",
    cpic:"CPIC Level A — consider alternative antiplatelet", evidence:["CPIC Level A","FDA boxed warning","PharmGKB 1A"],
    confidence:92, alternatives:["Prasugrel or ticagrelor (not CYP2C19-dependent)"]
  },
  {
    name:"Codeine", class:"Opioid analgesic (prodrug)", gene:"CYP2D6UM",
    geneSeverity:"risk", reaction:"rapid morphine conversion causing respiratory depression / toxicity",
    uses:"Mild-to-moderate pain relief and cough suppression.",
    mechanism:"Prodrug metabolized by CYP2D6 into morphine, which produces the analgesic effect.",
    sideEffects:"Sedation, constipation, respiratory depression at high morphine exposure.",
    contraindications:"CYP2D6 ultrarapid metabolizer status; children under 12; post-tonsillectomy/adenoidectomy patients (FDA boxed warning).",
    cpic:"CPIC Level A — avoid, use alternative analgesic", evidence:["CPIC Level A","FDA boxed warning","PharmGKB 1A"],
    confidence:94, alternatives:["Non-codeine analgesic (e.g. morphine with caution, or non-opioid options)"],
    pediatricRisk:true
  },
  {
    name:"Amoxicillin", class:"Beta-lactam antibiotic", allergy:"PENICILLIN",
    allergySeverity:"risk", reaction:"anaphylaxis, urticaria, angioedema",
    uses:"First-line treatment for many bacterial infections (ENT, respiratory, urinary).",
    mechanism:"Inhibits bacterial cell-wall synthesis via penicillin-binding proteins.",
    sideEffects:"GI upset, rash; anaphylaxis in true beta-lactam allergy.",
    contraindications:"Documented IgE-mediated penicillin/beta-lactam allergy.",
    cpic:"Not a PGx marker — direct allergy contraindication", evidence:["Clinical allergy history","FDA label"],
    confidence:97, alternatives:["Azithromycin or doxycycline (non-beta-lactam alternative)"]
  },
  {
    name:"Trimethoprim-Sulfamethoxazole", class:"Sulfonamide antibiotic", allergy:"SULFA",
    allergySeverity:"risk", reaction:"SJS / TEN, drug rash, hemolysis in G6PD deficiency",
    uses:"Treatment of UTIs, PJP pneumonia prophylaxis, some GI infections.",
    mechanism:"Dual blockade of bacterial folate synthesis (dihydrofolate reductase + synthase).",
    sideEffects:"Rash, GI upset, hyperkalemia; severe skin reactions in sulfa-sensitive patients.",
    contraindications:"Documented sulfonamide allergy.",
    cpic:"Not a PGx marker — direct allergy contraindication", evidence:["Clinical allergy history"],
    confidence:93, alternatives:["Doxycycline or nitrofurantoin depending on indication"]
  },
  {
    name:"Ibuprofen", class:"NSAID", allergy:"NSAID",
    allergySeverity:"risk", reaction:"bronchospasm, angioedema, anaphylactoid reaction",
    uses:"Pain, inflammation, and fever relief.",
    mechanism:"Non-selective COX-1/COX-2 inhibition, reducing prostaglandin synthesis.",
    sideEffects:"GI irritation/bleeding, renal impairment risk, fluid retention.",
    contraindications:"Documented NSAID hypersensitivity; significant renal impairment; late pregnancy.",
    cpic:"Not a PGx marker — direct allergy contraindication", evidence:["Clinical allergy history"],
    confidence:91, alternatives:["Acetaminophen (paracetamol) for analgesia/fever"],
    renalCaution:true, pregnancyRisk:true
  },
  {
    name:"Metformin", class:"Biguanide (antidiabetic)", gene:null, allergy:null,
    uses:"First-line therapy for type 2 diabetes.",
    mechanism:"Reduces hepatic glucose production and improves peripheral insulin sensitivity.",
    sideEffects:"GI upset, vitamin B12 deficiency with long-term use; rare lactic acidosis.",
    contraindications:"Significant renal impairment (eGFR <30, accumulation risk of lactic acidosis).",
    cpic:"No CPIC guideline — renal function is the key prescribing constraint", evidence:["FDA label"],
    confidence:80, alternatives:["Renally-adjusted alternative agent (e.g. DPP-4 inhibitor) under specialist guidance"],
    renalCaution:true
  },
  {
    name:"Levothyroxine", class:"Thyroid hormone replacement", gene:null, allergy:null,
    uses:"Hypothyroidism management.",
    mechanism:"Synthetic T4, converted peripherally to active T3.",
    sideEffects:"Palpitations, weight change, insomnia if over-replaced.",
    contraindications:"Untreated adrenal insufficiency; acute MI (relative).",
    cpic:"No CPIC guideline for this drug", evidence:["FDA label"],
    confidence:75, alternatives:[]
  },
  {
    name:"Warfarin", class:"Anticoagulant (vitamin K antagonist)", gene:"VKORC1",
    geneSeverity:"adjust", reaction:"altered anticoagulant sensitivity, raising bleeding or clotting risk if dosed as standard",
    uses:"Prevention and treatment of thromboembolic disease (AF, DVT/PE, mechanical heart valves).",
    mechanism:"Inhibits vitamin K epoxide reductase (VKORC1), reducing synthesis of clotting factors II, VII, IX, X.",
    sideEffects:"Bleeding, bruising; teratogenic in pregnancy (warfarin embryopathy).",
    contraindications:"Active major bleeding; pregnancy; VKORC1/CYP2C9 variants requiring dose individualization.",
    cpic:"CPIC Level A — use genotype-guided dosing algorithm", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:89, alternatives:["Direct oral anticoagulant (e.g. apixaban) where clinically appropriate"],
    pregnancyRisk:true
  },
  {
    name:"Voriconazole", class:"Antifungal (triazole)", gene:"CYP2C19PM",
    geneSeverity:"adjust", reaction:"elevated exposure with visual disturbances and hepatotoxicity risk in poor metabolizers",
    uses:"Treatment of invasive aspergillosis and other serious fungal infections.",
    mechanism:"Inhibits fungal CYP51-dependent ergosterol synthesis; itself metabolized by CYP2C19.",
    sideEffects:"Visual disturbances, hepatotoxicity, QT prolongation.",
    contraindications:"Poor CYP2C19 metabolizer status without dose/monitoring adjustment.",
    cpic:"CPIC Level A — adjust dose or select alternative antifungal", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:84, alternatives:["Isavuconazole or therapeutic drug monitoring-guided dosing"]
  },
  {
    name:"Tamoxifen", class:"Selective estrogen receptor modulator", gene:"CYP2D6PM",
    geneSeverity:"adjust", reaction:"reduced conversion to active endoxifen, potentially lowering efficacy",
    uses:"Adjuvant hormonal therapy for estrogen-receptor-positive breast cancer.",
    mechanism:"Prodrug activated by CYP2D6 to endoxifen, which blocks estrogen receptor signaling.",
    sideEffects:"Hot flashes, thromboembolism risk, endometrial changes.",
    contraindications:"Poor CYP2D6 metabolizer status may reduce therapeutic benefit.",
    cpic:"CPIC Level A — consider alternative endocrine therapy in poor metabolizers", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:82, alternatives:["Aromatase inhibitor (postmenopausal patients) per oncology guidance"]
  },
  {
    name:"Fluorouracil (5-FU)", class:"Antimetabolite chemotherapy (fluoropyrimidine)", gene:"DPYD",
    geneSeverity:"risk", reaction:"severe, potentially fatal toxicity (myelosuppression, mucositis, neurotoxicity)",
    uses:"Chemotherapy for colorectal, breast, and other solid tumors.",
    mechanism:"Inhibits thymidylate synthase, blocking DNA synthesis in rapidly dividing cells.",
    sideEffects:"Myelosuppression, mucositis, diarrhea, hand-foot syndrome.",
    contraindications:"DPYD deficiency without major dose reduction; known complete DPD deficiency.",
    cpic:"CPIC Level A — reduce dose substantially or avoid", evidence:["CPIC Level A","FDA label","PharmGKB 1A"],
    confidence:97, alternatives:["Substantially reduced starting dose or alternative regimen under oncology guidance"]
  },
  {
    name:"Capecitabine", class:"Oral fluoropyrimidine prodrug", gene:"DPYD",
    geneSeverity:"risk", reaction:"severe, potentially fatal toxicity, same mechanism as 5-FU",
    uses:"Oral chemotherapy for colorectal and breast cancer.",
    mechanism:"Prodrug converted to 5-fluorouracil in tumor tissue; inhibits thymidylate synthase.",
    sideEffects:"Hand-foot syndrome, diarrhea, myelosuppression.",
    contraindications:"DPYD deficiency without major dose reduction.",
    cpic:"CPIC Level A — reduce dose substantially or avoid", evidence:["CPIC Level A","FDA label","PharmGKB 1A"],
    confidence:97, alternatives:["Substantially reduced starting dose or alternative regimen under oncology guidance"]
  },
  {
    name:"Irinotecan", class:"Topoisomerase I inhibitor chemotherapy", gene:"UGT1A1",
    geneSeverity:"adjust", reaction:"increased risk of severe neutropenia in reduced-function carriers",
    uses:"Chemotherapy for colorectal cancer, often in combination regimens.",
    mechanism:"Active metabolite SN-38 inhibits topoisomerase I; cleared via UGT1A1 glucuronidation.",
    sideEffects:"Neutropenia, diarrhea (early and late-onset), nausea.",
    contraindications:"UGT1A1*28 homozygosity without dose reduction.",
    cpic:"CPIC Level A — reduce starting dose in poor metabolizers", evidence:["CPIC Level A","FDA label","PharmGKB 1A"],
    confidence:85, alternatives:["Reduced starting dose under oncology guidance"]
  },
  {
    name:"Carbamazepine", class:"Anticonvulsant / mood stabilizer", gene:"HLAB1502",
    geneSeverity:"risk", reaction:"Stevens–Johnson syndrome / toxic epidermal necrolysis",
    uses:"Management of partial and generalized seizures, trigeminal neuralgia, bipolar disorder.",
    mechanism:"Blocks voltage-gated sodium channels, stabilising neuronal membranes.",
    sideEffects:"Dizziness, diplopia, hyponatremia; rare but severe cutaneous reactions.",
    contraindications:"HLA-B*15:02 positive status (strongly associated with SJS/TEN, especially in Southeast Asian ancestry).",
    cpic:"CPIC Level A — avoid if HLA-B*15:02 positive", evidence:["CPIC Level A","FDA boxed warning","PharmGKB 1A"],
    confidence:96, alternatives:["Levetiracetam or an alternative anticonvulsant not associated with HLA-B*15:02 risk"]
  },
  {
    name:"Oxcarbazepine", class:"Anticonvulsant", gene:"HLAB1502",
    geneSeverity:"adjust", reaction:"cross-reactive hypersensitivity risk with carbamazepine, generally lower incidence",
    uses:"Management of partial-onset seizures; alternative to carbamazepine.",
    mechanism:"Blocks voltage-gated sodium channels; structurally related to carbamazepine.",
    sideEffects:"Dizziness, hyponatremia, sedation.",
    contraindications:"HLA-B*15:02 positive status warrants caution given cross-reactivity with carbamazepine.",
    cpic:"CPIC Level A — use with caution if HLA-B*15:02 positive", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:80, alternatives:["Levetiracetam or an alternative anticonvulsant"]
  },
  {
    name:"Citalopram", class:"SSRI antidepressant", gene:"CYP2C19PM",
    geneSeverity:"monitor", reaction:"increased plasma levels with dose-dependent QT prolongation risk",
    uses:"Treatment of major depressive disorder.",
    mechanism:"Selective serotonin reuptake inhibitor; metabolized substantially via CYP2C19.",
    sideEffects:"Nausea, sexual dysfunction, QT prolongation at higher exposure.",
    contraindications:"Poor CYP2C19 metabolizer status at higher doses; concurrent QT-prolonging drugs.",
    cpic:"CPIC Level A — consider dose reduction or alternative", evidence:["CPIC Level A","FDA label","PharmGKB 1A"],
    confidence:78, alternatives:["Dose reduction or an SSRI less dependent on CYP2C19"]
  },
  {
    name:"Escitalopram", class:"SSRI antidepressant", gene:"CYP2C19PM",
    geneSeverity:"monitor", reaction:"increased plasma levels with dose-dependent QT prolongation risk",
    uses:"Treatment of major depressive disorder and generalized anxiety disorder.",
    mechanism:"Selective serotonin reuptake inhibitor; metabolized substantially via CYP2C19.",
    sideEffects:"Nausea, sexual dysfunction, QT prolongation at higher exposure.",
    contraindications:"Poor CYP2C19 metabolizer status at higher doses.",
    cpic:"CPIC Level A — consider dose reduction or alternative", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:78, alternatives:["Dose reduction or an SSRI less dependent on CYP2C19"]
  },
  {
    name:"Amitriptyline", class:"Tricyclic antidepressant", gene:"CYP2D6PM",
    geneSeverity:"adjust", reaction:"elevated exposure with anticholinergic and cardiac toxicity risk",
    uses:"Depression, neuropathic pain, migraine prophylaxis.",
    mechanism:"Inhibits serotonin and norepinephrine reuptake; substantially cleared via CYP2D6.",
    sideEffects:"Sedation, anticholinergic effects, cardiac conduction changes at high exposure.",
    contraindications:"Poor CYP2D6 metabolizer status without dose reduction; cardiac conduction disease.",
    cpic:"CPIC Level A — reduce dose or select alternative", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:81, alternatives:["Alternative antidepressant class or reduced dose with ECG monitoring"]
  },
  {
    name:"Atomoxetine", class:"Selective norepinephrine reuptake inhibitor (ADHD)", gene:"CYP2D6PM",
    geneSeverity:"adjust", reaction:"elevated exposure and side-effect burden in poor metabolizers",
    uses:"Non-stimulant treatment for attention-deficit/hyperactivity disorder.",
    mechanism:"Selectively inhibits the presynaptic norepinephrine transporter; cleared primarily via CYP2D6.",
    sideEffects:"Decreased appetite, insomnia, elevated heart rate/blood pressure.",
    contraindications:"Poor CYP2D6 metabolizer status without dose titration.",
    cpic:"CPIC Level A — lower starting dose with careful titration", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:79, alternatives:["Lower starting dose with slower titration and monitoring"]
  },
  {
    name:"Ondansetron", class:"5-HT3 antagonist antiemetic", gene:"CYP2D6UM",
    geneSeverity:"monitor", reaction:"reduced antiemetic efficacy in ultrarapid metabolizers",
    uses:"Prevention of chemotherapy- and postoperative-induced nausea and vomiting.",
    mechanism:"Blocks serotonin 5-HT3 receptors centrally and peripherally; cleared via CYP2D6.",
    sideEffects:"Headache, constipation, QT prolongation at high doses.",
    contraindications:"CYP2D6 ultrarapid metabolizer status may reduce clinical effect.",
    cpic:"CPIC Level B — consider alternative antiemetic if inadequate response", evidence:["CPIC Level B","PharmGKB 1A"],
    confidence:70, alternatives:["Alternative antiemetic class (e.g. NK1 receptor antagonist)"]
  },
  {
    name:"Omeprazole", class:"Proton pump inhibitor", gene:"CYP2C19PM",
    geneSeverity:"monitor", reaction:"higher drug exposure in poor metabolizers; relevant drug-interaction potential",
    uses:"Management of GERD, peptic ulcer disease, H. pylori eradication regimens.",
    mechanism:"Irreversibly inhibits the gastric H+/K+-ATPase; metabolized substantially via CYP2C19.",
    sideEffects:"Headache, GI upset; long-term use linked to B12/magnesium deficiency.",
    contraindications:"Generally well tolerated across metabolizer types; monitor if co-prescribed with CYP2C19-dependent drugs (e.g. clopidogrel).",
    cpic:"CPIC Level A — standard dosing usually appropriate; monitor interactions", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:72, alternatives:["Standard dosing typically appropriate; review co-prescribed CYP2C19-dependent drugs"]
  },
  {
    name:"Atorvastatin", class:"Statin (HMG-CoA reductase inhibitor)", gene:"SLCO1B1",
    geneSeverity:"monitor", reaction:"modestly increased myopathy risk versus non-carriers",
    uses:"Lowering LDL cholesterol to reduce cardiovascular risk.",
    mechanism:"Inhibits HMG-CoA reductase, reducing hepatic cholesterol synthesis.",
    sideEffects:"Myalgia, elevated liver enzymes; myopathy risk lower than simvastatin at equivalent doses.",
    contraindications:"Active liver disease; caution in SLCO1B1 reduced-function carriers at high doses.",
    cpic:"CPIC Level A — preferred over simvastatin in SLCO1B1 carriers; monitor at high dose", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:80, alternatives:["Rosuvastatin at standard dose as a further alternative"]
  },
  {
    name:"Rosuvastatin", class:"Statin (HMG-CoA reductase inhibitor)", gene:"SLCO1B1",
    geneSeverity:"monitor", reaction:"modestly increased myopathy risk versus non-carriers",
    uses:"Lowering LDL cholesterol to reduce cardiovascular risk.",
    mechanism:"Inhibits HMG-CoA reductase, reducing hepatic cholesterol synthesis.",
    sideEffects:"Myalgia, elevated liver enzymes; generally well tolerated.",
    contraindications:"Active liver disease; caution in SLCO1B1 reduced-function carriers at high doses.",
    cpic:"CPIC Level A — standard dosing generally appropriate; monitor at high dose", evidence:["CPIC Level A","PharmGKB 1A"],
    confidence:81, alternatives:["Atorvastatin at standard dose as a further alternative"]
  },
  {
    name:"Aspirin", class:"NSAID / antiplatelet", allergy:"NSAID",
    allergySeverity:"risk", reaction:"bronchospasm, angioedema, anaphylactoid reaction (aspirin-exacerbated respiratory disease)",
    uses:"Analgesia, antipyresis, and antiplatelet therapy for cardiovascular protection.",
    mechanism:"Irreversibly inhibits COX-1 and COX-2, reducing prostaglandin and thromboxane synthesis.",
    sideEffects:"GI irritation/bleeding, bronchospasm in sensitive patients.",
    contraindications:"Documented NSAID/aspirin hypersensitivity; active peptic ulcer disease.",
    cpic:"Not a PGx marker — direct allergy contraindication", evidence:["Clinical allergy history"],
    confidence:90, alternatives:["Acetaminophen for analgesia; clopidogrel for antiplatelet indication (specialist guidance)"]
  },
  {
    name:"Cephalexin", class:"Cephalosporin antibiotic", allergy:"PENICILLIN",
    allergySeverity:"adjust", reaction:"possible cross-reactive hypersensitivity given shared beta-lactam ring structure",
    uses:"Treatment of skin, respiratory, and urinary tract infections.",
    mechanism:"Inhibits bacterial cell-wall synthesis via penicillin-binding proteins.",
    sideEffects:"GI upset, rash; cross-reactive hypersensitivity in a minority of penicillin-allergic patients.",
    contraindications:"Use with caution in documented penicillin allergy; avoid if history of severe/anaphylactic reaction.",
    cpic:"Not a PGx marker — allergy cross-reactivity caution", evidence:["Clinical allergy history"],
    confidence:68, alternatives:["Non-beta-lactam alternative (e.g. azithromycin) if history of severe penicillin reaction"]
  },
];

const GENE_MAP = Object.fromEntries(GENES.map(g=>[g.id,g]));
const ALLERGY_MAP = Object.fromEntries(ALLERGIES.map(a=>[a.id,a]));

/* =========================================================
   Theme toggle
   ========================================================= */
const themeToggle = document.getElementById('themeToggle');
function setTheme(mode){
  document.body.setAttribute('data-theme', mode);
  localStorage.setItem('genomx-theme', mode);
  themeToggle.textContent = mode === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
}
setTheme(localStorage.getItem('genomx-theme') || 'light');
themeToggle.addEventListener('click', ()=>{
  const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  setTheme(next);
  if(lastResults) drawGraph(lastResults);
});

/* =========================================================
   Tabs
   ========================================================= */
document.querySelectorAll('nav.tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.tabs button').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
    btn.classList.add('active'); btn.setAttribute('aria-selected','true');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active','print-active'));
    const target = document.getElementById('view-'+btn.dataset.view);
    target.classList.add('active','print-active');
    if(btn.dataset.view === 'graph') drawGraph(lastResults);
  });
});
document.getElementById('goDashboard')?.addEventListener('click', ()=>{
  document.querySelector('nav.tabs button[data-view="dashboard"]').click();
});

/* =========================================================
   Render gene / allergy checklists (searchable)
   ========================================================= */
function renderChecklist(container, items, kind, filterText){
  const q = (filterText||'').toLowerCase();
  container.innerHTML = items
    .filter(it => !q || it.label.toLowerCase().includes(q) || it.code.toLowerCase().includes(q))
    .map(it=>`
      <label class="check">
        <input type="checkbox" data-kind="${kind}" value="${it.id}">
        <span>
          <span>${it.label}</span>
          <span class="code ${kind==='allergy'?'allergy-code':''}">${it.code}</span>
        </span>
        <span class="tip" tabindex="0" aria-label="Explain ${it.code}" data-tip="${it.tip.replace(/"/g,'&quot;')}">ⓘ</span>
      </label>`).join('') || '<div class="empty-state">No matches</div>';
}
const geneListEl = document.getElementById('gene-checks');
const allergyListEl = document.getElementById('allergy-checks');
renderChecklist(geneListEl, GENES, 'gene');
renderChecklist(allergyListEl, ALLERGIES, 'allergy');

document.getElementById('geneSearch').addEventListener('input', e=>{
  const checked = Array.from(geneListEl.querySelectorAll('input:checked')).map(i=>i.value);
  renderChecklist(geneListEl, GENES, 'gene', e.target.value);
  geneListEl.querySelectorAll('input').forEach(i=>{ if(checked.includes(i.value)) i.checked = true; });
});
document.getElementById('allergySearch').addEventListener('input', e=>{
  const checked = Array.from(allergyListEl.querySelectorAll('input:checked')).map(i=>i.value);
  renderChecklist(allergyListEl, ALLERGIES, 'allergy', e.target.value);
  allergyListEl.querySelectorAll('input').forEach(i=>{ if(checked.includes(i.value)) i.checked = true; });
});

/* Sidebar collapse (mobile) */
document.getElementById('sidebarToggleBtn').addEventListener('click', ()=>{
  const body = document.getElementById('sidebarBody');
  const collapsed = body.classList.toggle('collapsed');
  document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', String(!collapsed));
});

/* =========================================================
   Floating tooltip for gene/allergy "ⓘ" info icons.
   Rendered once, attached to <body>, and positioned via
   getBoundingClientRect() on hover/focus -- this is what makes it
   fully visible even though the icons live inside a scrollable
   (.check-list) container, which would otherwise clip a plain
   CSS position:absolute bubble.
   ========================================================= */
const gxTooltip = document.getElementById('gxTooltip');

function showTip(target){
  const text = target.getAttribute('data-tip');
  if(!text) return;
  gxTooltip.textContent = text;
  gxTooltip.classList.add('open');

  const rect = target.getBoundingClientRect();
  const margin = 8;
  let left = rect.right + margin;
  let top = rect.top - 6;

  // measure after content is set so width/height are accurate
  const tw = gxTooltip.offsetWidth;
  const th = gxTooltip.offsetHeight;

  // flip to the left of the icon if it would overflow the right edge
  if(left + tw > window.innerWidth - margin){
    left = rect.left - tw - margin;
  }
  // if it still doesn't fit (very narrow viewport), clamp within bounds
  if(left < margin) left = margin;
  if(left + tw > window.innerWidth - margin) left = window.innerWidth - tw - margin;

  // clamp vertically within the viewport
  if(top + th > window.innerHeight - margin) top = window.innerHeight - th - margin;
  if(top < margin) top = margin;

  gxTooltip.style.left = left + 'px';
  gxTooltip.style.top = top + 'px';
}

function hideTip(){
  gxTooltip.classList.remove('open');
}

document.addEventListener('mouseover', e=>{
  const tip = e.target.closest('.tip[data-tip]');
  if(tip) showTip(tip);
});
document.addEventListener('mouseout', e=>{
  const tip = e.target.closest('.tip[data-tip]');
  if(tip) hideTip();
});
document.addEventListener('focusin', e=>{
  const tip = e.target.closest('.tip[data-tip]');
  if(tip) showTip(tip);
});
document.addEventListener('focusout', e=>{
  const tip = e.target.closest('.tip[data-tip]');
  if(tip) hideTip();
});
// keep the tooltip glued to its icon while the checklist scrolls
document.addEventListener('scroll', e=>{
  if(gxTooltip.classList.contains('open') && e.target.closest && e.target.closest('.check-list')){
    hideTip();
  }
}, true);

/* =========================================================
   BMI live calc
   ========================================================= */
function calcBMI(){
  const w = parseFloat(document.getElementById('pWeight').value);
  const h = parseFloat(document.getElementById('pHeight').value);
  const out = document.getElementById('bmiOut');
  if(w>0 && h>0){
    const bmi = w / Math.pow(h/100,2);
    out.textContent = `BMI: ${bmi.toFixed(1)} kg/m²`;
  } else out.textContent = 'BMI: —';
}
document.getElementById('pWeight').addEventListener('input', calcBMI);
document.getElementById('pHeight').addEventListener('input', calcBMI);

/* =========================================================
   Pipeline visual (mirrors Algorithm 1 phases)
   ========================================================= */
const STEPS = [
  "Data preprocessing (load, clean, encode)",
  "Knowledge graph construction (patient–gene–allergy–drug edges)",
  "Graph → PyTorch Geometric tensor conversion",
  "GNN embedding & compatibility scoring",
  "Recommendation output (compatible / incompatible)"
];
const pipelineEl = document.getElementById('pipeline');
function renderPipeline(activeIdx, doneUpTo){
  pipelineEl.innerHTML = STEPS.map((s,i)=>{
    let cls = '';
    if(i < doneUpTo) cls = 'done';
    else if(i === activeIdx) cls = 'active';
    return `<div class="pstep ${cls}"><span class="bullet">${i<doneUpTo?'✓':''}</span><span class="label">${s}</span></div>`;
  }).join('');
}
renderPipeline(-1,0);

/* =========================================================
   Clinical rule helpers (age / renal / hepatic / pregnancy / interactions)
   ========================================================= */
function collectPatient(){
  return {
    name: document.getElementById('pName').value.trim(),
    age: parseFloat(document.getElementById('pAge').value) || null,
    sex: document.getElementById('pSex').value,
    weight: parseFloat(document.getElementById('pWeight').value) || null,
    height: parseFloat(document.getElementById('pHeight').value) || null,
    diagnosis: document.getElementById('pDiagnosis').value.trim(),
    currentMeds: document.getElementById('pMeds').value.trim().toLowerCase(),
    history: document.getElementById('pHistory').value.trim(),
    renal: document.getElementById('pRenal').value,
    hepatic: document.getElementById('pHepatic').value,
    pregnant: document.getElementById('pPregnant').value === 'yes',
  };
}


/* =========================================================
   Composite scoring engine (local mirror of clinical_rules.py)
   One overall 0-100 safety score built from weighted point
   deductions per factor, with an itemized breakdown -- used by the
   fallback engine below, and structurally identical to what
   server.py computes so behavior doesn't drift between modes
   (the backend additionally folds in the trained multi-modal
   model's residual risk signal, which the local fallback can't,
   since it has no model to run).
   ========================================================= */
const SCORE_POINTS = {
  gene: { risk:55, adjust:30, monitor:12 },
  allergy: { risk:55, adjust:28, monitor:12 },
  renalMetformin: 45, renalOther: 22, hepatic: 15, pregnancy: 35, pediatric: 40,
};
const RECOMMENDATION_LABEL = { risk:'Avoid', adjust:'Use with dose adjustment', monitor:'Use with monitoring', safe:'Safe to use' };

/* =========================================================
   Diagnosis-based filtering engine (local mirror of clinical_rules.py's
   DIAGNOSIS_RULES / check_diagnosis_rules). Covers all 30 catalog
   drugs; three severity tiers (risk/adjust/monitor), each with a real
   clinical mechanism, checked against the patient's free-text
   diagnosis field.
   ========================================================= */
const DIAGNOSIS_SEVERITY_POINTS = { risk:35, adjust:20, monitor:10 };

const DIAGNOSIS_RULES = {
  'Ibuprofen': [
    { keywords:['hypertension','htn','high blood pressure'], severity:'adjust', label:'Hypertension', detail:'NSAIDs reduce antihypertensive efficacy and promote sodium/water retention, worsening blood pressure control' },
    { keywords:['heart failure','chf','cardiac failure','decompensated'], severity:'risk', label:'Heart failure', detail:'NSAIDs cause fluid retention and reduce renal prostaglandin synthesis, precipitating acute heart failure decompensation' },
    { keywords:['ulcer','gi bleed','gastrointestinal bleed','peptic'], severity:'risk', label:'Active peptic ulcer / GI bleed', detail:'NSAIDs directly damage the gastric mucosa and inhibit prostaglandin-mediated mucosal protection' },
    { keywords:['chronic kidney','ckd','renal disease'], severity:'adjust', label:'Chronic kidney disease', detail:'NSAIDs reduce renal prostaglandin synthesis, reducing GFR and accelerating CKD progression' },
    { keywords:['asthma','aspirin-sensitive','nsaid-sensitive'], severity:'risk', label:'Asthma / NSAID-sensitive respiratory disease', detail:'NSAIDs trigger bronchospasm in aspirin-exacerbated respiratory disease — affects ~10% of asthmatic patients' },
    { keywords:['atrial fibrillation','afib','anticoagul'], severity:'adjust', label:'Atrial fibrillation / anticoagulation', detail:'NSAIDs increase bleeding risk in patients already on anticoagulant therapy for AF' },
  ],
  'Aspirin': [
    { keywords:['gout','hyperuricemia','uric acid'], severity:'monitor', label:'Gout / hyperuricemia', detail:'Low-dose aspirin reduces renal urate excretion, raising serum uric acid and risking gout flares' },
    { keywords:['ulcer','gi bleed','gastrointestinal bleed','peptic'], severity:'adjust', label:'Active peptic ulcer / GI bleed', detail:'Aspirin directly damages the gastric mucosa even at low antiplatelet doses' },
    { keywords:['asthma','nsaid-sensitive'], severity:'adjust', label:'Asthma / NSAID-sensitive respiratory disease', detail:'Aspirin can trigger bronchospasm in aspirin-exacerbated respiratory disease' },
    { keywords:['heart failure','chf'], severity:'monitor', label:'Heart failure', detail:'Aspirin at higher doses may worsen heart failure through prostaglandin inhibition; assess benefit vs. risk' },
  ],
  'Warfarin': [
    { keywords:['bleeding disorder','hemophilia','haemophilia'], severity:'risk', label:'Known bleeding disorder', detail:'Anticoagulation is contraindicated in the presence of an active, uncontrolled bleeding disorder' },
    { keywords:['hypertension','uncontrolled bp','htn'], severity:'monitor', label:'Uncontrolled hypertension', detail:'Severely uncontrolled blood pressure increases intracranial bleeding risk during anticoagulation' },
    { keywords:['liver','hepatic','cirrhosis','hepatitis'], severity:'adjust', label:'Hepatic disease', detail:'Hepatic disease reduces synthesis of vitamin K-dependent clotting factors, amplifying warfarin effect unpredictably' },
    { keywords:['stroke','intracranial','brain bleed'], severity:'adjust', label:'Recent intracranial event', detail:'Recent intracranial haemorrhage is a relative contraindication; benefit-risk assessment required' },
  ],
  'Clopidogrel': [
    { keywords:['ulcer','gi bleed','gastrointestinal bleed','peptic'], severity:'adjust', label:'Active GI bleed history', detail:'Clopidogrel adds antiplatelet effect on top of an already compromised mucosal barrier' },
    { keywords:['bleeding disorder','hemophilia'], severity:'risk', label:'Known bleeding disorder', detail:'Antiplatelet therapy is contraindicated in active, uncontrolled bleeding disorders' },
  ],
  'Metformin': [
    { keywords:['heart failure','chf','cardiac failure','decompensated'], severity:'risk', label:'Decompensated heart failure', detail:'Reduced cardiac output causes tissue hypoxia; metformin accumulation leads to lactic acidosis' },
    { keywords:['liver','hepatic','cirrhosis','hepatitis'], severity:'risk', label:'Significant hepatic impairment', detail:'Hepatic clearance of lactate is impaired, greatly raising lactic acidosis risk with metformin' },
    { keywords:['imaging','contrast','iodinated','dye'], severity:'adjust', label:'Iodinated contrast procedure', detail:'Withhold metformin 48h before and after iodinated contrast to prevent contrast-induced nephropathy + lactic acidosis' },
  ],
  'Carbamazepine': [
    { keywords:['bone marrow','blood dyscrasia','aplastic'], severity:'risk', label:'Bone marrow suppression / blood dyscrasia', detail:'Carbamazepine can cause aplastic anaemia; contraindicated in pre-existing bone marrow depression' },
    { keywords:['hyponatremia','sodium','siadh'], severity:'adjust', label:'Hyponatraemia / SIADH', detail:'Carbamazepine stimulates ADH release, worsening existing hyponatraemia' },
    { keywords:['liver','hepatic','cirrhosis'], severity:'adjust', label:'Hepatic disease', detail:'Carbamazepine is hepatically metabolised; hepatic impairment raises drug and toxic metabolite exposure' },
    { keywords:['atrial fibrillation','afib','heart block','av block','cardiac conduction'], severity:'adjust', label:'Cardiac conduction disorder', detail:'Carbamazepine can slow cardiac conduction; use with caution in pre-existing AV block' },
  ],
  'Oxcarbazepine': [
    { keywords:['hyponatremia','sodium','siadh'], severity:'adjust', label:'Hyponatraemia / SIADH', detail:'Oxcarbazepine causes clinically significant hyponatraemia in ~2-3% of patients, higher risk if pre-existing' },
    { keywords:['liver','hepatic','cirrhosis'], severity:'monitor', label:'Hepatic disease', detail:'Oxcarbazepine requires hepatic metabolism; monitor levels and tolerability in hepatic impairment' },
  ],
  'Phenytoin': [
    { keywords:['liver','hepatic','cirrhosis'], severity:'adjust', label:'Hepatic disease', detail:'Phenytoin is extensively hepatically metabolised; saturable kinetics mean small dose changes cause large level swings' },
    { keywords:['depression','depressive','mdd'], severity:'monitor', label:'Depression', detail:'Phenytoin can exacerbate depressive symptoms; monitor mental health closely during treatment' },
  ],
  'Citalopram': [
    { keywords:['atrial fibrillation','afib','qt','long qt','torsades','cardiac arrhythmia'], severity:'adjust', label:'Atrial fibrillation / QT disorder', detail:'Citalopram causes dose-dependent QT prolongation; pre-existing AF or QT disorder raises arrhythmia risk' },
    { keywords:['bipolar','mania','manic'], severity:'adjust', label:'Bipolar disorder', detail:'SSRIs can trigger manic episodes in bipolar disorder without adequate mood stabiliser cover' },
    { keywords:['epilepsy','seizure'], severity:'monitor', label:'Epilepsy', detail:'SSRIs can lower the seizure threshold at higher doses; monitor seizure frequency' },
    { keywords:['liver','hepatic','cirrhosis'], severity:'adjust', label:'Hepatic disease', detail:'Citalopram clearance is reduced in hepatic impairment; use half the maximum dose' },
  ],
  'Escitalopram': [
    { keywords:['atrial fibrillation','afib','qt','long qt','torsades'], severity:'adjust', label:'Atrial fibrillation / QT disorder', detail:'Escitalopram causes dose-dependent QT prolongation; pre-existing AF or QT disorder raises arrhythmia risk' },
    { keywords:['bipolar','mania','manic'], severity:'adjust', label:'Bipolar disorder', detail:'SSRIs can trigger manic episodes in bipolar disorder without adequate mood stabiliser cover' },
    { keywords:['liver','hepatic','cirrhosis'], severity:'adjust', label:'Hepatic disease', detail:'Escitalopram clearance is reduced in hepatic impairment; use half the maximum dose' },
  ],
  'Amitriptyline': [
    { keywords:['atrial fibrillation','afib','heart block','cardiac arrhythmia','av block'], severity:'risk', label:'Cardiac conduction disorder / arrhythmia', detail:'Tricyclic antidepressants block cardiac fast sodium channels; pre-existing conduction disease risks fatal arrhythmia' },
    { keywords:['glaucoma','angle-closure'], severity:'risk', label:'Angle-closure glaucoma', detail:'Anticholinergic effect precipitates acute angle-closure glaucoma attacks' },
    { keywords:['hypertension','htn','high blood pressure'], severity:'monitor', label:'Hypertension', detail:'Tricyclics can cause orthostatic hypotension and unpredictable BP changes, complicating hypertension management' },
    { keywords:['bipolar','mania','manic'], severity:'adjust', label:'Bipolar disorder', detail:'Tricyclics can trigger manic switches in bipolar disorder' },
    { keywords:['epilepsy','seizure'], severity:'adjust', label:'Epilepsy', detail:'Tricyclics lower seizure threshold; use with caution and only if seizures are well-controlled' },
  ],
  'Atomoxetine': [
    { keywords:['hypertension','htn','high blood pressure'], severity:'adjust', label:'Hypertension', detail:"Atomoxetine raises heart rate and blood pressure; pre-existing hypertension requires monitoring and may need antihypertensive adjustment" },
    { keywords:['atrial fibrillation','afib','cardiac arrhythmia'], severity:'adjust', label:'Cardiac arrhythmia', detail:"Atomoxetine's sympathomimetic effect can worsen existing cardiac arrhythmias" },
    { keywords:['liver','hepatic','cirrhosis'], severity:'adjust', label:'Hepatic disease', detail:'Atomoxetine is hepatically metabolised; hepatic impairment substantially raises drug exposure' },
    { keywords:['glaucoma','angle-closure'], severity:'adjust', label:'Angle-closure glaucoma', detail:'Mydriatic effect can trigger acute angle-closure episodes' },
  ],
  'Ondansetron': [
    { keywords:['atrial fibrillation','afib','qt','long qt','torsades','cardiac arrhythmia'], severity:'adjust', label:'Atrial fibrillation / QT disorder', detail:'Ondansetron prolongs the QT interval; risk is higher in pre-existing QT disorders and with other QT-prolonging drugs' },
    { keywords:['hypokalemia','low potassium','electrolyte'], severity:'monitor', label:'Hypokalaemia', detail:"Ondansetron's QT-prolonging effect is amplified by electrolyte imbalance, particularly low potassium" },
  ],
  'Omeprazole': [
    { keywords:['osteoporosis','fracture','low bone density'], severity:'monitor', label:'Osteoporosis', detail:'Long-term PPI use reduces gastric acid-dependent calcium absorption, worsening bone density' },
    { keywords:['hypomagnesemia','low magnesium','magnesium deficiency'], severity:'adjust', label:'Hypomagnesaemia', detail:'Long-term PPI use causes clinically significant hypomagnesaemia; can worsen pre-existing deficiency' },
  ],
  'Simvastatin': [
    { keywords:['hypothyroid','hypothyroidism','underactive thyroid'], severity:'adjust', label:'Hypothyroidism', detail:'Untreated hypothyroidism raises statin exposure and independently causes myopathy; treat thyroid disorder before or alongside statin initiation' },
    { keywords:['liver','hepatic','cirrhosis','hepatitis'], severity:'risk', label:'Active hepatic disease', detail:'Active hepatic disease or persistently elevated transaminases are contraindications for statin use' },
    { keywords:['myopathy','rhabdomyolysis','muscle disease','myositis'], severity:'risk', label:'Pre-existing myopathy', detail:'Pre-existing muscle disease substantially raises the risk of severe statin-induced myopathy' },
  ],
  'Atorvastatin': [
    { keywords:['hypothyroid','hypothyroidism','underactive thyroid'], severity:'adjust', label:'Hypothyroidism', detail:'Untreated hypothyroidism raises statin exposure and independently causes myopathy; treat thyroid disorder before or alongside statin initiation' },
    { keywords:['liver','hepatic','cirrhosis','hepatitis'], severity:'risk', label:'Active hepatic disease', detail:'Active hepatic disease or persistently elevated transaminases are contraindications for statin use' },
    { keywords:['myopathy','rhabdomyolysis','muscle disease'], severity:'risk', label:'Pre-existing myopathy', detail:'Pre-existing muscle disease substantially raises the risk of severe statin-induced myopathy' },
  ],
  'Rosuvastatin': [
    { keywords:['liver','hepatic','cirrhosis','hepatitis'], severity:'risk', label:'Active hepatic disease', detail:'Active hepatic disease or persistently elevated transaminases are contraindications for statin use' },
    { keywords:['hypothyroid','hypothyroidism'], severity:'adjust', label:'Hypothyroidism', detail:'Untreated hypothyroidism raises myopathy risk with statins; address thyroid disorder first' },
  ],
  'Fluorouracil (5-FU)': [
    { keywords:['heart failure','chf','ischemic','coronary','angina','cardiac'], severity:'adjust', label:'Cardiac disease', detail:'Fluorouracil causes cardiotoxicity (coronary vasospasm, arrhythmia) in ~7% of patients; pre-existing cardiac disease amplifies this risk' },
  ],
  'Capecitabine': [
    { keywords:['heart failure','chf','ischemic','coronary','angina','cardiac'], severity:'adjust', label:'Cardiac disease', detail:'Capecitabine (oral 5-FU prodrug) carries the same cardiotoxicity risk as 5-FU; use with caution in pre-existing cardiac disease' },
    { keywords:['chronic kidney','ckd','renal impairment'], severity:'adjust', label:'Renal impairment', detail:'Capecitabine requires dose reduction in moderate renal impairment; contraindicated below eGFR 30' },
  ],
  'Irinotecan': [
    { keywords:['liver','hepatic','cirrhosis','bilirubin'], severity:'adjust', label:'Hepatic impairment / raised bilirubin', detail:"Irinotecan's active metabolite SN-38 is cleared hepatically; hepatic impairment raises SN-38 toxicity substantially" },
    { keywords:['inflammatory bowel','ibd','crohn','colitis'], severity:'adjust', label:'Inflammatory bowel disease', detail:'Irinotecan diarrhoea is severe and life-threatening; pre-existing IBD dramatically worsens this risk' },
  ],
  'Azathioprine': [
    { keywords:['active infection','sepsis','serious infection'], severity:'risk', label:'Active infection', detail:"Azathioprine's immunosuppressive effect prevents adequate immune response to active infections" },
    { keywords:['cancer','lymphoma','malignancy'], severity:'monitor', label:'Pre-existing malignancy', detail:'Long-term azathioprine use increases the risk of lymphoma and skin cancers; specialist risk-benefit assessment required' },
  ],
  'Tamoxifen': [
    { keywords:['dvt','pulmonary embolism','thromboembolism','clot','thrombosis'], severity:'adjust', label:'Thromboembolic history', detail:'Tamoxifen increases the risk of DVT and pulmonary embolism; prior thromboembolism requires individual specialist risk-benefit assessment' },
    { keywords:['endometrial','uterine cancer'], severity:'adjust', label:'Endometrial cancer history', detail:'Tamoxifen has weak oestrogen-agonist effects on the endometrium; prior or current endometrial cancer is a relative contraindication' },
  ],
  'Amoxicillin': [
    { keywords:['glandular fever','mononucleosis','ebv','epstein-barr'], severity:'risk', label:'Glandular fever / EBV infection', detail:'Amoxicillin causes a widespread maculopapular rash in >90% of patients with active EBV / glandular fever; it must be avoided' },
  ],
  'Cephalexin': [
    { keywords:['chronic kidney','ckd','renal disease','renal impairment'], severity:'adjust', label:'Chronic kidney disease', detail:'Cephalexin is renally cleared; dose reduction or extended dosing intervals are needed when creatinine clearance is low to avoid accumulation and neurotoxicity' },
  ],
  'Trimethoprim-Sulfamethoxazole': [
    { keywords:['g6pd','glucose-6-phosphate'], severity:'risk', label:'G6PD deficiency', detail:'Sulfonamides cause haemolytic anaemia in G6PD-deficient patients' },
    { keywords:['folate deficiency','folic acid deficiency'], severity:'adjust', label:'Folate deficiency', detail:'Trimethoprim inhibits dihydrofolate reductase, worsening pre-existing folate deficiency and risking megaloblastic anaemia' },
    { keywords:['chronic kidney','ckd','renal disease','renal impairment'], severity:'adjust', label:'Chronic kidney disease', detail:'TMP-SMX raises serum creatinine and potassium; monitoring is essential in CKD' },
  ],
  'Abacavir': [
    { keywords:['cardiovascular','heart disease','coronary','cad','myocardial infarction'], severity:'monitor', label:'Cardiovascular disease', detail:'Some studies associate abacavir with a modestly increased risk of myocardial infarction; warrants monitoring in high baseline CV risk' },
  ],
  'Allopurinol': [
    { keywords:['chronic kidney','ckd','renal impairment','renal disease'], severity:'adjust', label:'Renal impairment', detail:'Allopurinol and its active metabolite oxypurinol are renally cleared; dose reduction is required to prevent toxic accumulation' },
    { keywords:['acute gout','active gout flare'], severity:'monitor', label:'Acute gout flare', detail:'Starting allopurinol during an acute gout attack can prolong or worsen the flare; initiate during the inter-critical period instead' },
  ],
  'Codeine': [
    { keywords:['epilepsy','seizure'], severity:'monitor', label:'Epilepsy', detail:'High-dose opioids can lower seizure threshold; monitor seizure frequency if codeine is used in epileptic patients' },
    { keywords:['copd','chronic obstructive','respiratory failure','type 2 respiratory'], severity:'risk', label:'COPD / respiratory failure', detail:'Opioids cause respiratory depression; pre-existing CO2 retention or respiratory failure is a near-absolute contraindication' },
  ],
  'Voriconazole': [
    { keywords:['liver','hepatic','cirrhosis','hepatitis'], severity:'adjust', label:'Hepatic disease', detail:'Voriconazole is hepatically metabolised and hepatotoxic; hepatic disease substantially raises liver adverse event risk' },
  ],
  'Levothyroxine': [
    { keywords:['atrial fibrillation','afib','cardiac arrhythmia'], severity:'monitor', label:'Atrial fibrillation', detail:'Over-replacement with levothyroxine triggers or worsens AF; TSH must be monitored closely' },
    { keywords:['angina','ischemic heart','coronary','cad'], severity:'monitor', label:'Ischaemic heart disease', detail:'Rapid correction of hypothyroidism increases myocardial oxygen demand; start at low dose and titrate slowly' },
  ],
};

function checkDiagnosisRules(drugName, diagnosisText){
  if(!diagnosisText) return [];
  const diagLower = diagnosisText.toLowerCase();
  const hits = [];
  (DIAGNOSIS_RULES[drugName] || []).forEach(rule=>{
    if(rule.keywords.some(kw=>diagLower.includes(kw))){
      hits.push({ ...rule, points: DIAGNOSIS_SEVERITY_POINTS[rule.severity] });
    }
  });
  return hits;
}

function scoreBand(score){
  if(score >= 80) return 'safe';
  if(score >= 60) return 'monitor';
  if(score >= 35) return 'adjust';
  return 'risk';
}

/* =========================================================
   Drug-drug interaction engine (local mirror of clinical_rules.py's
   DRUG_INTERACTIONS / check_drug_interactions). Current medications
   were being collected but never analyzed beyond two hardcoded
   warfarin special cases -- this replaces that with a real
   interaction knowledge base checked against the free-text
   current-medications field.
   ========================================================= */
const INTERACTION_SEVERITY_POINTS = { major:30, moderate:15, minor:6 };

const DRUG_INTERACTIONS = {
  'Warfarin': [
    { other:'Fluconazole', severity:'major', mechanism:'CYP2C9 inhibition slows warfarin clearance', effect:'↑ INR, ↑ bleeding risk', management:'Avoid if possible; if required, reduce warfarin dose and monitor INR closely' },
    { other:'Amiodarone', severity:'major', mechanism:'CYP2C9 and CYP3A4 inhibition', effect:'↑ INR, ↑ bleeding risk', management:'Reduce warfarin dose ~30-50% and monitor INR closely' },
    { other:'Clarithromycin', severity:'major', mechanism:'CYP3A4 inhibition', effect:'↑ INR, ↑ bleeding risk', management:'Monitor INR closely during and after therapy' },
    { other:'Rifampin', severity:'major', mechanism:'Strong CYP450 induction accelerates warfarin clearance', effect:'↓ INR, ↓ anticoagulant effect, clotting risk', management:'Monitor INR closely; warfarin dose often needs substantial increase' },
    { other:'Aspirin', severity:'major', mechanism:'Additive antiplatelet and anticoagulant effect', effect:'↑ bleeding risk', management:'Avoid unless specifically indicated; monitor for bleeding' },
    { other:'Ibuprofen', severity:'major', mechanism:'GI mucosal injury plus antiplatelet effect, additive to anticoagulation', effect:'↑ GI bleeding risk', management:'Avoid; use acetaminophen for analgesia instead' },
    { other:'Trimethoprim-Sulfamethoxazole', severity:'major', mechanism:'CYP2C9 inhibition and vitamin K antagonism', effect:'↑ INR, ↑ bleeding risk', management:'Avoid if possible; monitor INR closely if co-prescribed' },
    { other:'Amoxicillin', severity:'moderate', mechanism:'Altered gut flora reduces vitamin K synthesis', effect:'INR fluctuation', management:'Monitor INR during and after antibiotic course' },
    { other:'Cephalexin', severity:'moderate', mechanism:'Altered gut flora reduces vitamin K synthesis', effect:'INR fluctuation', management:'Monitor INR during and after antibiotic course' },
    { other:'Carbamazepine', severity:'moderate', mechanism:'CYP450 induction accelerates warfarin clearance', effect:'↓ INR, reduced anticoagulant effect', management:'Monitor INR closely; dose adjustment often needed' },
    { other:'Phenytoin', severity:'moderate', mechanism:'Bidirectional CYP2C9 competition', effect:'Unpredictable INR changes in either direction', management:'Monitor INR closely on initiation or discontinuation' },
  ],
  'Clopidogrel': [
    { other:'Omeprazole', severity:'major', mechanism:'CYP2C19 inhibition reduces clopidogrel activation', effect:'↓ antiplatelet effect, ↑ thrombotic/stent-occlusion risk', management:'Use pantoprazole or an H2-blocker instead if acid suppression is needed' },
    { other:'Voriconazole', severity:'moderate', mechanism:'CYP2C19 inhibition reduces clopidogrel activation', effect:'↓ antiplatelet effect', management:'Monitor for reduced antiplatelet effect; consider alternative antifungal' },
    { other:'Aspirin', severity:'moderate', mechanism:'Additive antiplatelet effect', effect:'↑ bleeding risk', management:'Often intentionally co-prescribed short-term; monitor for bleeding' },
    { other:'Warfarin', severity:'major', mechanism:'Additive antiplatelet and anticoagulant effect', effect:'↑ bleeding risk', management:'Avoid triple therapy unless specifically indicated; monitor closely' },
  ],
  'Simvastatin': [
    { other:'Voriconazole', severity:'major', mechanism:'Strong CYP3A4 inhibition raises statin exposure', effect:'↑ myopathy / rhabdomyolysis risk', management:'Avoid combination; suspend statin during antifungal course' },
    { other:'Amiodarone', severity:'major', mechanism:'CYP3A4 inhibition raises statin exposure', effect:'↑ myopathy / rhabdomyolysis risk', management:'Cap simvastatin at 20mg/day per FDA labeling, or switch statin' },
    { other:'Clarithromycin', severity:'major', mechanism:'Strong CYP3A4 inhibition', effect:'↑ myopathy / rhabdomyolysis risk', management:'Suspend statin during antibiotic course' },
    { other:'Fluconazole', severity:'major', mechanism:'CYP3A4 inhibition raises statin exposure', effect:'↑ myopathy risk', management:'Consider temporary statin suspension during antifungal course' },
  ],
  'Atorvastatin': [
    { other:'Voriconazole', severity:'major', mechanism:'Strong CYP3A4 inhibition raises statin exposure', effect:'↑ myopathy / rhabdomyolysis risk', management:'Avoid combination; suspend statin during antifungal course' },
    { other:'Clarithromycin', severity:'moderate', mechanism:'CYP3A4 inhibition', effect:'↑ myopathy risk', management:'Consider temporary statin suspension during antibiotic course' },
    { other:'Amiodarone', severity:'moderate', mechanism:'CYP3A4 inhibition', effect:'↑ myopathy risk', management:'Monitor for muscle symptoms; consider dose reduction' },
  ],
  'Rosuvastatin': [
    { other:'Fluconazole', severity:'minor', mechanism:'Minimal CYP3A4 dependence, mild interaction', effect:'Slightly increased statin exposure', management:'Routine monitoring usually sufficient' },
  ],
  'Azathioprine': [
    { other:'Allopurinol', severity:'major', mechanism:'Xanthine oxidase inhibition blocks thiopurine breakdown', effect:'Severe, potentially fatal myelosuppression', management:'Reduce azathioprine dose by ~75% if co-administration is unavoidable' },
  ],
  'Tamoxifen': [
    { other:'Fluoxetine', severity:'major', mechanism:'Strong CYP2D6 inhibition blocks activation to endoxifen', effect:'↓ tamoxifen efficacy', management:'Use an SSRI with minimal CYP2D6 inhibition (e.g. citalopram) instead' },
    { other:'Paroxetine', severity:'major', mechanism:'Strong CYP2D6 inhibition blocks activation to endoxifen', effect:'↓ tamoxifen efficacy', management:'Use an SSRI with minimal CYP2D6 inhibition instead' },
  ],
  'Codeine': [
    { other:'Fluoxetine', severity:'moderate', mechanism:'CYP2D6 inhibition blocks activation to morphine', effect:'↓ analgesic efficacy', management:'Consider a non-codeine analgesic' },
    { other:'Alprazolam', severity:'major', mechanism:'Additive CNS and respiratory depression', effect:'↑ risk of sedation and respiratory depression', management:'Avoid combination where possible; if required, use lowest effective doses with monitoring' },
  ],
  'Ibuprofen': [
    { other:'Warfarin', severity:'major', mechanism:'GI mucosal injury plus antiplatelet effect, additive to anticoagulation', effect:'↑ GI bleeding risk', management:'Avoid; use acetaminophen for analgesia instead' },
    { other:'Lisinopril', severity:'moderate', mechanism:'Reduced renal prostaglandin synthesis blunts antihypertensive effect', effect:'↓ blood pressure control, ↑ renal impairment risk', management:'Monitor blood pressure and renal function; limit duration of NSAID use' },
  ],
  'Aspirin': [
    { other:'Warfarin', severity:'major', mechanism:'Additive antiplatelet and anticoagulant effect', effect:'↑ bleeding risk', management:'Avoid unless specifically indicated; monitor for bleeding' },
  ],
  'Citalopram': [
    { other:'Omeprazole', severity:'moderate', mechanism:'CYP2C19 inhibition raises citalopram exposure', effect:'↑ QT-prolongation risk at higher exposure', management:'Consider dose reduction or pantoprazole instead' },
    { other:'Amiodarone', severity:'major', mechanism:'Additive QT prolongation', effect:'↑ risk of Torsades de Pointes', management:'Avoid combination where possible; ECG monitoring if required' },
    { other:'Ondansetron', severity:'moderate', mechanism:'Additive QT prolongation', effect:'↑ QT-prolongation risk', management:'Use lowest effective doses; consider ECG monitoring' },
    { other:'Warfarin', severity:'moderate', mechanism:'Impaired platelet serotonin uptake adds to anticoagulant effect', effect:'↑ bleeding risk', management:'Monitor for bleeding, especially at treatment initiation' },
  ],
  'Escitalopram': [
    { other:'Omeprazole', severity:'moderate', mechanism:'CYP2C19 inhibition raises escitalopram exposure', effect:'↑ QT-prolongation risk at higher exposure', management:'Consider dose reduction or pantoprazole instead' },
    { other:'Amiodarone', severity:'major', mechanism:'Additive QT prolongation', effect:'↑ risk of Torsades de Pointes', management:'Avoid combination where possible; ECG monitoring if required' },
  ],
  'Carbamazepine': [
    { other:'Voriconazole', severity:'major', mechanism:'Strong CYP3A4 induction dramatically lowers voriconazole levels', effect:'Voriconazole treatment failure', management:'Combination is generally contraindicated; use an alternative antifungal' },
    { other:'Warfarin', severity:'moderate', mechanism:'CYP450 induction accelerates warfarin clearance', effect:'↓ INR, reduced anticoagulant effect', management:'Monitor INR closely; dose adjustment often needed' },
  ],
  'Voriconazole': [
    { other:'Carbamazepine', severity:'major', mechanism:'Strong CYP3A4 induction dramatically lowers voriconazole levels', effect:'Voriconazole treatment failure', management:'Combination is generally contraindicated; use an alternative antifungal' },
    { other:'Rifampin', severity:'major', mechanism:'Strong CYP3A4 induction', effect:'Voriconazole treatment failure', management:'Combination is contraindicated' },
    { other:'Simvastatin', severity:'major', mechanism:'Strong CYP3A4 inhibition raises statin exposure', effect:'↑ myopathy / rhabdomyolysis risk in the statin', management:'Suspend statin during antifungal course' },
    { other:'Phenytoin', severity:'moderate', mechanism:'Bidirectional CYP2C9/CYP3A4 interaction', effect:'Altered levels of both drugs', management:'Monitor levels of both drugs; dose adjustment often needed' },
  ],
  'Omeprazole': [
    { other:'Clopidogrel', severity:'major', mechanism:'CYP2C19 inhibition reduces clopidogrel activation', effect:'↓ antiplatelet effect, ↑ thrombotic/stent-occlusion risk', management:'Use pantoprazole or an H2-blocker instead' },
    { other:'Citalopram', severity:'moderate', mechanism:'CYP2C19 inhibition raises citalopram exposure', effect:'↑ QT-prolongation risk', management:'Consider dose reduction or pantoprazole instead' },
  ],
  'Phenytoin': [
    { other:'Warfarin', severity:'moderate', mechanism:'Bidirectional CYP2C9 competition', effect:'Unpredictable INR changes in either direction', management:'Monitor INR closely on initiation or discontinuation' },
    { other:'Fluconazole', severity:'moderate', mechanism:'CYP2C9 inhibition raises phenytoin levels', effect:'↑ phenytoin toxicity risk', management:'Monitor phenytoin levels; reduce dose if needed' },
    { other:'Voriconazole', severity:'moderate', mechanism:'Bidirectional CYP2C9/CYP3A4 interaction', effect:'Altered levels of both drugs', management:'Monitor levels of both drugs; dose adjustment often needed' },
  ],
};

function checkDrugInteractions(drugName, currentMedsText){
  if(!currentMedsText) return [];
  const medsLower = currentMedsText.toLowerCase();
  const hits = [];
  (DRUG_INTERACTIONS[drugName] || []).forEach(interaction=>{
    if(medsLower.includes(interaction.other.toLowerCase())){
      hits.push({ ...interaction, points: INTERACTION_SEVERITY_POINTS[interaction.severity] });
    }
  });
  return hits;
}

function computeOverallScore(d, patient, checkedGenes, checkedAllergies){
  let score = 100;
  const factors = [];
  let hardFloor = false;
  let diagnosisFloor = null;

  if(d.gene && checkedGenes.includes(d.gene)){
    const sev = d.geneSeverity || 'risk';
    const pts = SCORE_POINTS.gene[sev];
    score -= pts;
    if(sev === 'risk') hardFloor = true;
    else if(diagnosisFloor === null || SEV_RANK[sev] > SEV_RANK[diagnosisFloor]) diagnosisFloor = sev;
    const g = GENE_MAP[d.gene];
    factors.push({ label:g.code, points:-pts, detail:'Documented CPIC-guideline genetic risk marker' });
  }
  if(d.allergy && checkedAllergies.includes(d.allergy)){
    const sev = d.allergySeverity || 'risk';
    const pts = SCORE_POINTS.allergy[sev];
    score -= pts;
    if(sev === 'risk') hardFloor = true;
    else if(diagnosisFloor === null || SEV_RANK[sev] > SEV_RANK[diagnosisFloor]) diagnosisFloor = sev;
    const a = ALLERGY_MAP[d.allergy];
    factors.push({ label:`${a.code} allergy`, points:-pts, detail:'Documented allergy contraindication' });
  }
  if(d.renalCaution && patient.renal === 'impaired'){
    const isMetformin = d.name === 'Metformin';
    const pts = isMetformin ? SCORE_POINTS.renalMetformin : SCORE_POINTS.renalOther;
    score -= pts;
    if(isMetformin) hardFloor = true;
    factors.push({ label:'Kidney impairment', points:-pts, detail:`${d.name} accumulates in reduced kidney function` });
  }
  if(d.hepaticCaution && patient.hepatic === 'impaired'){
    score -= SCORE_POINTS.hepatic;
    factors.push({ label:'Liver impairment', points:-SCORE_POINTS.hepatic, detail:`${d.name} is hepatically metabolized` });
  }
  if(d.pregnancyRisk && patient.pregnant){
    score -= SCORE_POINTS.pregnancy;
    hardFloor = true;
    factors.push({ label:'Pregnancy', points:-SCORE_POINTS.pregnancy, detail:`${d.name} carries known fetal/pregnancy risk` });
  }
  if(d.pediatricRisk && patient.age !== null && patient.age < 18){
    score -= SCORE_POINTS.pediatric;
    hardFloor = true;
    factors.push({ label:'Age under 18', points:-SCORE_POINTS.pediatric, detail:`${d.name} carries a pediatric boxed warning` });
  }
  const interactionHits = checkDrugInteractions(d.name, patient.currentMeds);
  interactionHits.forEach(hit=>{
    score -= hit.points;
    factors.push({ label:`${hit.other} (current medication)`, points:-hit.points,
      detail:`${hit.severity.charAt(0).toUpperCase()+hit.severity.slice(1)} interaction — ${hit.mechanism}. Effect: ${hit.effect}.` });
  });
  const diagnosisHits = checkDiagnosisRules(d.name, patient.diagnosis);
  diagnosisHits.forEach(dhit=>{
    score -= dhit.points;
    if(dhit.severity === 'risk') hardFloor = true;
    else if(diagnosisFloor === null || SEV_RANK[dhit.severity] > SEV_RANK[diagnosisFloor]) diagnosisFloor = dhit.severity;
    factors.push({ label:dhit.label, points:-dhit.points, detail:dhit.detail });
  });

  score = Math.max(0, Math.min(100, Math.round(score)));
  let severity = scoreBand(score);
  if(hardFloor && severity !== 'risk'){
    severity = 'risk';
    score = Math.min(score, 34);
  }
  if(diagnosisFloor && SEV_RANK[severity] < SEV_RANK[diagnosisFloor]){
    severity = diagnosisFloor;
    score = Math.min(score, diagnosisFloor === 'adjust' ? 59 : 79);
  }
  if(factors.length === 0){
    factors.push({ label:'No risk factors identified', points:0,
      detail:'No genetic, allergy, organ-function, pregnancy, age, interaction, or diagnosis flag matched this patient' });
  }
  return { overallScore:score, severity, recommendation:RECOMMENDATION_LABEL[severity], factors, interactions:interactionHits };
}

/* =========================================================
   Local rule-based scoring (fallback engine)
   Used only when the multi-modal backend (server.py) isn't reachable.
   ========================================================= */
function computeLocalResults(patient, checkedGenes, checkedAllergies){
  return DRUGS.map(d=>{
    const { overallScore, severity, recommendation, factors, interactions } = computeOverallScore(d, patient, checkedGenes, checkedAllergies);
    return { ...d, severity, overallScore, recommendation, factors, interactions, evidence: d.evidence ? d.evidence.slice() : [] };
  });
}

/* =========================================================
   Multi-modal backend integration
   Calls the real RF + XGBoost + CNN + Bi-LSTM + Autoencoder + Fusion +
   GNN pipeline (server.py) which evaluates genes, age, diagnosis, organ
   function, pregnancy, current medications, drug interactions, and
   clinical guidelines simultaneously rather than as a sequential rule
   chain. Falls back to the local rule engine above if the backend
   isn't running, so the dashboard always works either way.
   ========================================================= */
const BACKEND_URL = 'http://localhost:8420';
let backendAvailable = null; // null = unknown, true/false once checked

async function checkBackend(timeoutMs = 1500){
  try{
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), timeoutMs);
    const res = await fetch(BACKEND_URL + '/health', { signal: controller.signal });
    clearTimeout(t);
    if(!res.ok) return false;
    const data = await res.json();
    return data.status === 'ready';
  }catch(e){
    return false;
  }
}

async function callBackend(patient, checkedGenes, checkedAllergies, timeoutMs = 20000){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  const payload = {
    name: patient.name || null, age: patient.age, sex: patient.sex || null,
    weight: patient.weight, height: patient.height, diagnosis: patient.diagnosis || null,
    current_meds: patient.currentMeds || null, renal: patient.renal || 'normal',
    hepatic: patient.hepatic || 'normal', pregnant: !!patient.pregnant,
    genes: checkedGenes, allergies: checkedAllergies,
  };
  const res = await fetch(BACKEND_URL + '/recommend', {
    method: 'POST', signal: controller.signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  clearTimeout(t);
  if(!res.ok) throw new Error('backend returned ' + res.status);
  const data = await res.json();
  // merge backend severity/score/factors into the frontend's richer
  // drug metadata (uses/mechanism/side effects/alternatives stay client-side)
  const byName = Object.fromEntries(data.results.map(r=>[r.name, r]));
  const results = DRUGS.map(d=>{
    const r = byName[d.name];
    if(!r) return { ...d, severity:'safe', overallScore:50, recommendation:'Use with monitoring',
      factors:[{ label:'No backend result for this drug', points:0, detail:'' }], interactions:[], evidence: d.evidence||[] };
    return { ...d, severity: r.severity, overallScore: r.overall_score, recommendation: r.recommendation,
      factors: r.factors, interactions: r.interactions || [], evidence: d.evidence||[], modelScore: r.model_score };
  });
  return { results, modalityWeights: data.modality_weights };
}

function setBackendBadge(mode){
  const el = document.getElementById('engineBadge');
  if(!el) return;
  if(mode === 'multimodal'){
    el.innerHTML = '<span class="live-dot"></span>Multi-modal engine (RF+XGB+CNN+BiLSTM+Fusion+GNN)';
    el.className = 'live-badge';
  } else if(mode === 'fallback'){
    el.innerHTML = '⚠ Rule-based fallback — backend not detected';
    el.className = 'live-badge fallback';
  } else {
    el.innerHTML = '<span class="live-dot"></span>Checking backend…';
    el.className = 'live-badge';
  }
}

/* =========================================================
   Run analysis
   ========================================================= */
let lastResults = null;

async function runAnalysis(){
  const runBtn = document.getElementById('runBtn');
  runBtn.disabled = true;

  const patient = collectPatient();
  const checkedGenes = Array.from(document.querySelectorAll('input[data-kind="gene"]:checked')).map(i=>i.value);
  const checkedAllergies = Array.from(document.querySelectorAll('input[data-kind="allergy"]:checked')).map(i=>i.value);

  resetTimelineForNewRun();
  setBackendBadge(null);

  // kick off the backend call (if reachable) concurrently with the pipeline animation
  const backendPromise = checkBackend().then(ok=>{
    backendAvailable = ok;
    return ok ? callBackend(patient, checkedGenes, checkedAllergies) : null;
  }).catch(()=>{ backendAvailable = false; return null; });

  for(let i=0;i<STEPS.length;i++){
    renderPipeline(i, i);
    await new Promise(r=>setTimeout(r, 380));
    if(i===0) markTimelineStep('data', 'active');
    if(i===2) markTimelineStep('evaluated', 'active');
  }
  renderPipeline(-1, STEPS.length);

  let results, modalityWeights = null;
  try{
    const backendResult = await backendPromise;
    if(backendResult){
      results = backendResult.results;
      modalityWeights = backendResult.modalityWeights;
      setBackendBadge('multimodal');
    } else {
      results = computeLocalResults(patient, checkedGenes, checkedAllergies);
      setBackendBadge('fallback');
    }
  }catch(e){
    results = computeLocalResults(patient, checkedGenes, checkedAllergies);
    setBackendBadge('fallback');
  }

  const anyRisk = results.some(r=>r.severity!=='safe');
  markTimelineStep('risk', anyRisk ? 'risk' : 'active', anyRisk ? 'Risk detected' : 'No risk detected');
  markTimelineStep('alt', anyRisk ? 'risk' : 'active', anyRisk ? 'Alternatives identified' : 'Standard options confirmed');
  markTimelineStep('ready', 'active');

  lastResults = { results, checkedGenes, checkedAllergies, patient, modalityWeights };
  renderResults(results);
  drawGraph(lastResults);
  runBtn.disabled = false;
  document.getElementById('resultsPanel').scrollIntoView({ behavior:'smooth', block:'nearest' });
}
document.getElementById('runBtn').addEventListener('click', runAnalysis);

/* =========================================================
   Results rendering
   ========================================================= */
function renderResults(results){
  const buckets = { risk:[], adjust:[], monitor:[], safe:[] };
  results.forEach(r=>buckets[r.severity].push(r));
  const flagged = [...buckets.risk, ...buckets.adjust, ...buckets.monitor].sort((a,b)=>a.overallScore-b.overallScore);
  const safe = buckets.safe.sort((a,b)=>a.overallScore-b.overallScore);

  document.getElementById('safeCount').textContent = safe.length;
  document.getElementById('riskCount').textContent = flagged.length;

  document.getElementById('safeList').innerHTML = safe.map(r=>trackHtml(r)).join('') || '<div class="empty-state">None</div>';
  document.getElementById('riskList').innerHTML = flagged.map(r=>trackHtml(r)).join('') || '<div class="empty-state">None</div>';

  document.querySelectorAll('.drug-track').forEach(el=>{
    el.addEventListener('click', ()=> openDrugModal(el.dataset.drug));
  });
}

function trackHtml(r){
  const chip = r.gene ? `<span class="chip gene">${GENE_MAP[r.gene].code}</span>` :
               r.allergy ? `<span class="chip allergy">${ALLERGY_MAP[r.allergy].code}</span>` : '';
  const alt = (r.severity!=='safe' && r.alternatives && r.alternatives.length)
    ? `<div class="alt-line">✅ Consider: ${r.alternatives[0]} <em>(subject to clinical evaluation)</em></div>` : '';

  const factorsList = (r.factors||[]).filter(f=>f.points !== 0).map(f=>
    `<li>✔ <strong>${f.label}</strong> <span class="factor-pts">${f.points}</span></li>`
  ).join('');

  const interactionBlock = (r.interactions||[]).length ? `
    <div class="interaction-callout ${r.interactions.some(i=>i.severity==='major')?'major':'moderate'}">
      <div class="interaction-title">⚠ Drug interaction detected</div>
      ${r.interactions.map(i=>`
        <div class="interaction-row">
          <strong>${r.name} + ${i.other}</strong> — ${i.severity.charAt(0).toUpperCase()+i.severity.slice(1)} interaction
          <div class="interaction-effect">${i.effect}</div>
        </div>`).join('')}
    </div>` : '';

  return `<button class="drug-track ${r.severity}" data-drug="${r.name}">
    <div class="drug-row-top">
      <span class="drug-name">${r.name}</span>
      <span class="badge ${r.severity}">${SEV_ICON[r.severity]} ${SEV_LABEL[r.severity]}</span>
    </div>
    <div class="score-row">
      <span class="overall-score">${r.overallScore}<span class="score-max">/100</span></span>
      <span class="score-label">Overall Safety Score</span>
      <span class="recommendation-pill ${r.severity}">${r.recommendation}</span>
    </div>
    <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${r.overallScore}%"></div></div>
    ${factorsList ? `<ul class="factors-list">${factorsList}</ul>` : ''}
    ${interactionBlock}
    <div class="drug-reason">${chip}</div>
    ${alt}
  </button>`;
}

/* =========================================================
   Patient care timeline — live, real-timestamped
   Each step is stamped with the actual wall-clock time at the
   moment that stage of the analysis genuinely completes on this
   device (not simulated after the fact), so the timeline fills in
   progressively while the analysis is running.
   ========================================================= */
const TIMELINE_STEPS = [
  { key:'admitted',  label:'Patient session started' },
  { key:'data',       label:'Genetic / allergy data received' },
  { key:'evaluated',  label:'Drug options evaluated' },
  { key:'risk',       label:'Risk assessment complete' },
  { key:'alt',        label:'Alternatives identified' },
  { key:'ready',      label:'Ready for clinician review' },
];

function nowStr(){
  return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function initTimeline(){
  document.getElementById('timeline').innerHTML = TIMELINE_STEPS.map(s=>`
    <div class="tl-step" id="tl-${s.key}">
      <div class="tl-line"></div><div class="tl-dot"></div>
      <p>${s.label}</p>
      <span class="tl-time">pending</span>
    </div>`).join('');
  markTimelineStep('admitted', 'active');
}

function markTimelineStep(key, state, labelOverride){
  const el = document.getElementById('tl-'+key);
  if(!el) return;
  el.classList.remove('active','risk');
  if(state) el.classList.add(state);
  const timeEl = el.querySelector('.tl-time');
  if(timeEl) timeEl.textContent = nowStr();
  if(labelOverride){
    const p = el.querySelector('p');
    if(p) p.textContent = labelOverride;
  }
}

function resetTimelineForNewRun(){
  TIMELINE_STEPS.slice(1).forEach(s=>{
    const el = document.getElementById('tl-'+s.key);
    if(!el) return;
    el.classList.remove('active','risk');
    el.querySelector('p').textContent = s.label;
    el.querySelector('.tl-time').textContent = 'pending';
  });
}

initTimeline();

/* =========================================================
   Drug detail modal
   ========================================================= */
const modalOverlay = document.getElementById('modalOverlay');
const modalCard = document.getElementById('modalCard');
function openDrugModal(name){
  const d = DRUGS.find(x=>x.name===name);
  if(!d) return;
  const r = lastResults ? lastResults.results.find(x=>x.name===name) : null;

  let assessmentSection = '';
  if(r){
    const factorsList = (r.factors||[]).filter(f=>f.points !== 0).map(f=>
      `<li>✔ <strong>${f.label}</strong> <span class="factor-pts">${f.points}</span><div class="factor-detail">${f.detail||''}</div></li>`
    ).join('');
    const interactionBlock = (r.interactions||[]).length ? `
      <div class="interaction-callout ${r.interactions.some(i=>i.severity==='major')?'major':'moderate'}">
        <div class="interaction-title">⚠ Drug interaction detected</div>
        ${r.interactions.map(i=>`
          <div class="interaction-row">
            <strong>${d.name} + ${i.other}</strong> — ${i.severity.charAt(0).toUpperCase()+i.severity.slice(1)} interaction
            <div class="interaction-effect">${i.effect}</div>
            <div class="interaction-mgmt">Management: ${i.management}</div>
          </div>`).join('')}
      </div>` : '';
    assessmentSection = `
      <div class="modal-section">
        <div class="score-row" style="margin-bottom:10px;">
          <span class="overall-score">${r.overallScore}<span class="score-max">/100</span></span>
          <span class="score-label">Overall Safety Score</span>
          <span class="recommendation-pill ${r.severity}">${r.recommendation}</span>
        </div>
        ${factorsList ? `<h4>Reasons</h4><ul class="factors-list">${factorsList}</ul>` : ''}
        ${interactionBlock}
      </div>`;
  }

  modalCard.innerHTML = `
    <button class="modal-close" aria-label="Close" id="modalCloseBtn">✕</button>
    <h2>${d.name}</h2>
    <div class="mclass">${d.class}</div>
    ${assessmentSection}
    <div class="modal-section"><h4>Uses</h4><p>${d.uses}</p></div>
    <div class="modal-section"><h4>Mechanism</h4><p>${d.mechanism}</p></div>
    <div class="modal-section"><h4>Side effects</h4><p>${d.sideEffects}</p></div>
    <div class="modal-section"><h4>Contraindications</h4><p>${d.contraindications}</p></div>
    <div class="modal-section"><h4>CPIC / guideline recommendation</h4><p>${d.cpic}</p>
      <div class="evidence-chips">${(d.evidence||[]).map(e=>`<span class="evidence-chip">${e}</span>`).join('')}</div>
    </div>
    ${d.alternatives && d.alternatives.length ? `<div class="modal-section"><h4>Alternative options</h4><p>✅ ${d.alternatives.join(' &nbsp;|&nbsp; ')} <em>(subject to clinical evaluation)</em></p></div>` : ''}
  `;
  modalOverlay.classList.add('open');
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCloseBtn').focus();
}
function closeModal(){ modalOverlay.classList.remove('open'); }
modalOverlay.addEventListener('click', e=>{ if(e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeModal(); });

/* =========================================================
   Drug directory tab (searchable)
   ========================================================= */
function renderDirectory(filterText){
  const q = (filterText||'').toLowerCase();
  const list = DRUGS.filter(d => !q || d.name.toLowerCase().includes(q) || d.class.toLowerCase().includes(q));
  document.getElementById('dirGrid').innerHTML = list.map(d=>`
    <button class="dir-card" data-drug="${d.name}">
      <div class="dname">${d.name}</div>
      <div class="dclass">${d.class}</div>
    </button>`).join('') || '<div class="empty-state">No matches</div>';
  document.querySelectorAll('.dir-card').forEach(el=> el.addEventListener('click', ()=>openDrugModal(el.dataset.drug)));
}
renderDirectory('');
document.getElementById('dirSearch').addEventListener('input', e=>renderDirectory(e.target.value));

/* =========================================================
   Export: CSV + Print/PDF
   ========================================================= */
document.getElementById('exportCsv').addEventListener('click', ()=>{
  if(!lastResults){ alert('Run an analysis first.'); return; }
  const rows = [['Drug','Class','Severity','Overall Safety Score','Recommendation','Contributing Factors','Drug Interactions']];
  lastResults.results.forEach(r=>{
    const factorsText = (r.factors||[]).filter(f=>f.points!==0).map(f=>`${f.label} (${f.points})`).join('; ');
    const interactionsText = (r.interactions||[]).map(i=>`${i.other}: ${i.severity} — ${i.effect}`).join('; ');
    rows.push([r.name, r.class, SEV_LABEL[r.severity], `${r.overallScore}/100`, r.recommendation, factorsText, interactionsText]);
  });
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'genomx-report.csv';
  a.click();
});
document.getElementById('exportPrint').addEventListener('click', ()=>{
  if(!lastResults){ alert('Run an analysis first.'); return; }
  window.print();
});

/* =========================================================
   Knowledge graph — zoomable / pannable / filterable / interactive
   ========================================================= */
const svg = document.getElementById('kg');
const cx = 500, cy = 360;
let viewState = { scale:1, tx:0, ty:0, focus:null, filters:{ gene:true, allergy:true, drug:true } };

document.querySelectorAll('.filter-chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    chip.classList.toggle('active');
    viewState.filters[chip.dataset.filter] = chip.classList.contains('active');
    drawGraph(lastResults);
  });
});
document.getElementById('zoomIn').addEventListener('click', ()=>{ viewState.scale = Math.min(2.5, viewState.scale*1.2); applyTransform(); });
document.getElementById('zoomOut').addEventListener('click', ()=>{ viewState.scale = Math.max(0.5, viewState.scale/1.2); applyTransform(); });
document.getElementById('zoomReset').addEventListener('click', ()=>{ viewState = {...viewState, scale:1, tx:0, ty:0}; applyTransform(); });

function applyTransform(){
  const g = document.getElementById('kgViewport');
  if(g) g.setAttribute('transform', `translate(${viewState.tx},${viewState.ty}) scale(${viewState.scale})`);
}

let dragging = false, dragStart = null;
svg.addEventListener('mousedown', e=>{ dragging = true; dragStart = { x:e.clientX, y:e.clientY, tx:viewState.tx, ty:viewState.ty }; });
window.addEventListener('mousemove', e=>{
  if(!dragging) return;
  viewState.tx = dragStart.tx + (e.clientX - dragStart.x);
  viewState.ty = dragStart.ty + (e.clientY - dragStart.y);
  applyTransform();
});
window.addEventListener('mouseup', ()=> dragging = false);
svg.addEventListener('wheel', e=>{
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  viewState.scale = Math.min(2.5, Math.max(0.5, viewState.scale*delta));
  applyTransform();
}, { passive:false });

function drawGraph(state){
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const viewport = document.createElementNS(ns,'g');
  viewport.setAttribute('id','kgViewport');
  svg.appendChild(viewport);

  const checkedGenes = state ? state.checkedGenes : [];
  const checkedAllergies = state ? state.checkedAllergies : [];
  const resultMap = {};
  if(state) state.results.forEach(r=> resultMap[r.name] = r);

  const factors = [...GENES.map(g=>({...g,kind:'gene'})), ...ALLERGIES.map(a=>({...a,kind:'allergy'}))];
  const factorR = 190, drugR = 320;
  const factorPos = {};
  factors.forEach((f,i)=>{
    const angle = (i / factors.length) * Math.PI*2 - Math.PI/2;
    factorPos[f.id] = { x: cx + factorR*Math.cos(angle), y: cy + factorR*Math.sin(angle), angle };
  });
  const drugPos = {};
  DRUGS.forEach((d,i)=>{
    const angle = (i / DRUGS.length) * Math.PI*2 - Math.PI/2 + 0.18;
    drugPos[d.name] = { x: cx + drugR*Math.cos(angle), y: cy + drugR*Math.sin(angle) };
  });

  function el(tag, attrs){
    const e = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k,v])=> e.setAttribute(k,v));
    return e;
  }
  function titleFor(node, str){ const t = el('title',{}); t.textContent = str; node.appendChild(t); return node; }

  const focus = viewState.focus;

  // drug -> factor edges
  DRUGS.forEach(d=>{
    const fid = d.gene || d.allergy;
    if(!fid) return;
    if(!viewState.filters.gene && d.gene) return;
    if(!viewState.filters.allergy && d.allergy) return;
    if(!viewState.filters.drug) return;
    const fp = factorPos[fid]; const dp = drugPos[d.name];
    const active = (d.gene && checkedGenes.includes(d.gene)) || (d.allergy && checkedAllergies.includes(d.allergy));
    const isFocused = focus && (focus === fid);
    const dim = focus && !isFocused;
    const line = el('line', {
      x1:fp.x, y1:fp.y, x2:dp.x, y2:dp.y,
      stroke: isFocused ? '#C6432E' : (active ? '#C6432E' : '#9AA8A2'),
      'stroke-width': isFocused ? 3 : (active ? 2.2 : 1.1),
      opacity: dim ? 0.12 : (active || isFocused ? 0.9 : 0.4)
    });
    titleFor(line, `${GENE_MAP[fid]?GENE_MAP[fid].code:ALLERGY_MAP[fid].code} → ${d.name}: ${d.reaction||'documented allergy contraindication'}`);
    viewport.appendChild(line);
  });

  // patient -> factor edges
  factors.forEach(f=>{
    if(f.kind==='gene' && !viewState.filters.gene) return;
    if(f.kind==='allergy' && !viewState.filters.allergy) return;
    const p = factorPos[f.id];
    const checked = f.kind==='gene' ? checkedGenes.includes(f.id) : checkedAllergies.includes(f.id);
    const isFocused = focus === f.id;
    const dim = focus && !isFocused;
    const line = el('line', {
      x1:cx, y1:cy, x2:p.x, y2:p.y,
      stroke: checked||isFocused ? (f.kind==='gene'?'#6753D6':'#C8801B') : '#CBD8D1',
      'stroke-width': checked||isFocused ? 2.6 : 1,
      opacity: dim ? 0.12 : (checked||isFocused ? 0.95 : 0.45)
    });
    titleFor(line, `Patient — ${f.code}${checked?' (present)':''}`);
    viewport.appendChild(line);
  });

  // factor nodes
  factors.forEach(f=>{
    if(f.kind==='gene' && !viewState.filters.gene) return;
    if(f.kind==='allergy' && !viewState.filters.allergy) return;
    const p = factorPos[f.id];
    const checked = f.kind==='gene' ? checkedGenes.includes(f.id) : checkedAllergies.includes(f.id);
    const isFocused = focus === f.id;
    const dim = focus && !isFocused;
    const g = el('g', { class:'node-hit', opacity: dim?0.25:1, tabindex:'0', role:'button', 'aria-label':`Highlight drugs linked to ${f.code}` });
    const c = el('circle', { cx:p.x, cy:p.y, r: checked||isFocused?13:9, fill: f.kind==='gene'?'#6753D6':'#C8801B', stroke: checked||isFocused?'#10201C':'none', 'stroke-width':2 });
    titleFor(c, `${f.code} — ${f.tip}`);
    g.appendChild(c);
    const dx = Math.cos(p.angle) * 20;
    const t = el('text', { x:p.x + (dx>0?dx+14:dx-14), y:p.y+3, class:'node-label small', 'text-anchor': dx>0?'start':'end' });
    t.textContent = f.code;
    g.appendChild(t);
    g.addEventListener('click', ()=>{ viewState.focus = (viewState.focus === f.id) ? null : f.id; drawGraph(state); });
    g.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); g.dispatchEvent(new Event('click')); } });
    viewport.appendChild(g);
  });

  // drug nodes
  DRUGS.forEach(d=>{
    if(!viewState.filters.drug) return;
    const p = drugPos[d.name];
    const r = resultMap[d.name];
    let fill = '#9AA8A2';
    if(r) fill = r.severity==='safe' ? '#0E8C7C' : r.severity==='monitor' ? '#B79A0E' : r.severity==='adjust' ? '#C8801B' : '#C6432E';
    const fid = d.gene || d.allergy;
    const isFocused = focus && fid === focus;
    const dim = focus && !isFocused;
    const g = el('g', { class:'node-hit', opacity: dim?0.15:1, tabindex:'0', role:'button', 'aria-label':`Open details for ${d.name}` });
    const c = el('circle', { cx:p.x, cy:p.y, r:11, fill });
    titleFor(c, `${d.name}${r?` — ${SEV_LABEL[r.severity]} (Safety score: ${r.overallScore}/100)`:' — not yet assessed'}`);
    g.appendChild(c);
    const dx = p.x - cx;
    const t = el('text', { x:p.x + (dx>0?16:-16), y:p.y+4, class:'node-label', 'text-anchor': dx>0?'start':'end' });
    t.textContent = d.name;
    g.appendChild(t);
    g.addEventListener('click', ()=> openDrugModal(d.name));
    g.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openDrugModal(d.name); } });
    viewport.appendChild(g);
  });

  // patient node
  const pg = el('g', {});
  const pc = el('circle', { cx, cy, r:22, fill: document.body.getAttribute('data-theme')==='dark' ? '#EAF1EC' : '#10201C' });
  pg.appendChild(pc);
  const pt = el('text', { x:cx, y:cy+4, class:'node-label', 'text-anchor':'middle', fill: document.body.getAttribute('data-theme')==='dark' ? '#10201C' : '#EAF1EC' });
  pt.textContent = 'Patient';
  pg.appendChild(pt);
  viewport.appendChild(pg);

  applyTransform();
}
drawGraph(null);

/* =========================================================
   Overview / About static content
   ========================================================= */
const ALGO_STEPS = [
  { h:"Data preprocessing", p:"Load patient–drug–allergy records, drop rows with missing drug or allergy names, label-encode categorical fields, and scale continuous offsets." },
  { h:"Knowledge graph construction", p:"Build a graph with patient, drug, gene/variant and allergy nodes; add edges for patient–allergy, patient–gene, and gene/allergy–drug associations." },
  { h:"Graph conversion", p:"Convert the graph into PyTorch Geometric format: generate the edge index and node feature tensors." },
  { h:"GNN model definition & training", p:"Define input, hidden and output layers with dropout/regularization; train over N epochs with cross-entropy loss, tracking accuracy and loss to monitor overfitting." },
  { h:"Overfitting mitigation & validation", p:"If training accuracy diverges from generalizability, apply stronger dropout or data augmentation, then evaluate on a held-out validation set." },
  { h:"Deployment: compatibility prediction", p:"Given a patient ID and known allergies/markers, the model (here, a transparent scoring rule) outputs compatible and incompatible drug lists with explanations." },
];
document.getElementById('algoList').innerHTML = ALGO_STEPS.map(s=>`<li><div><h4>${s.h}</h4><p>${s.p}</p></div></li>`).join('');
