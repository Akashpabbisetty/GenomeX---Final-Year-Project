"""
knowledge_graph.py
=================================================================
Algorithm 7: Knowledge Graph Construction.

Extends the earlier patient-drug-allergy graph (used in the first
GenomX GNN backend) with two more node types -- genes and variants --
and the five edge types Algorithm 7 specifies:

    Patient-has-Allergy
    Patient-has-Gene          (here: Patient-has-Variant, since each
                                patient carries a specific allele of a gene)
    Drug-metabolized-by-Gene
    Gene-associated-with-Allergy
    Drug-causes-ADR           (a documented patient-drug reaction)

This is pure networkx/pandas -- no deep-learning dependency -- so it
runs for real in any environment.
=================================================================
"""

import os
import random
import numpy as np
import pandas as pd
import networkx as nx


class GenomXKnowledgeGraph:
    def __init__(self):
        self.G = nx.Graph()
        self.node_id = {}          # ("type", name) -> integer node id
        self.node_info = {}        # integer node id -> {"type":..., "label":...}
        self._next_id = 0

    def _get_or_create_node(self, node_type: str, name: str) -> int:
        key = (node_type, name)
        if key not in self.node_id:
            nid = self._next_id
            self.node_id[key] = nid
            self.node_info[nid] = {"type": node_type, "label": name}
            self.G.add_node(nid, type=node_type, label=name)
            self._next_id += 1
        return self.node_id[key]

    # ---- Algorithm 7, line 6: define nodes -------------------------
    def add_patient(self, patient_id):
        return self._get_or_create_node("patient", patient_id)

    def add_drug(self, drug_name):
        return self._get_or_create_node("drug", drug_name)

    def add_allergy(self, allergy_name):
        return self._get_or_create_node("allergy", allergy_name)

    def add_gene(self, gene_name):
        return self._get_or_create_node("gene", gene_name)

    def add_variant(self, gene_name, variant_name):
        return self._get_or_create_node("variant", f"{gene_name}::{variant_name}")

    # ---- Algorithm 7, line 7: create typed edges --------------------
    def add_patient_has_allergy(self, patient_id, allergy_name):
        p, a = self.add_patient(patient_id), self.add_allergy(allergy_name)
        self.G.add_edge(p, a, relation="Patient-has-Allergy")

    def add_patient_has_variant(self, patient_id, gene_name, variant_name):
        p = self.add_patient(patient_id)
        v = self.add_variant(gene_name, variant_name)
        g = self.add_gene(gene_name)
        self.G.add_edge(p, v, relation="Patient-has-Gene")
        self.G.add_edge(v, g, relation="Variant-of-Gene")

    def add_drug_metabolized_by_gene(self, drug_name, gene_name):
        d, g = self.add_drug(drug_name), self.add_gene(gene_name)
        self.G.add_edge(d, g, relation="Drug-metabolized-by-Gene")

    def add_gene_associated_with_allergy(self, gene_name, allergy_name):
        g, a = self.add_gene(gene_name), self.add_allergy(allergy_name)
        self.G.add_edge(g, a, relation="Gene-associated-with-Allergy")

    def add_drug_causes_adr(self, patient_id, drug_name, allergy_name):
        p, d, a = self.add_patient(patient_id), self.add_drug(drug_name), self.add_allergy(allergy_name)
        self.G.add_edge(p, d, relation="Drug-causes-ADR")
        self.G.add_edge(d, a, relation="Drug-linked-to-Allergy")

    # ---- Algorithm 7, lines 8-9: cleanup + validation ---------------
    def deduplicate_and_validate(self):
        """Remove duplicate edges (line 8) -- networkx.Graph already
        collapses parallel edges by construction, so this mainly
        re-validates the graph is well-formed (line 9)."""
        isolated = list(nx.isolates(self.G))
        if isolated:
            print(f"[kg.validate] removing {len(isolated)} isolated nodes")
            self.G.remove_nodes_from(isolated)
        n_components = nx.number_connected_components(self.G)
        print(f"[kg.validate] {self.G.number_of_nodes()} nodes, {self.G.number_of_edges()} edges, "
              f"{n_components} connected component(s)")
        return self.G

    def node_type_counts(self):
        counts = {}
        for _, data in self.G.nodes(data=True):
            counts[data["type"]] = counts.get(data["type"], 0) + 1
        return counts


def build_knowledge_graph(clinical_df: pd.DataFrame, genomic_df: pd.DataFrame,
                           patient_drug_allergy_df: pd.DataFrame,
                           drug_gene_df: pd.DataFrame, gene_allergy_df: pd.DataFrame) -> GenomXKnowledgeGraph:
    """Wires together all five source tables (Algorithm 7, lines 1-4)
    into one graph (lines 5-9)."""
    kg = GenomXKnowledgeGraph()

    for _, row in clinical_df.iterrows():
        kg.add_patient(row["patient_id"])
        if row.get("allergy_history"):
            for allergy in str(row["allergy_history"]).split(","):
                allergy = allergy.strip()
                if allergy:
                    kg.add_patient_has_allergy(row["patient_id"], allergy)

    # Only risk variants ("present") become edges. Previously every patient was
    # linked to BOTH the present and absent node of all 12 genes, so those edges
    # carried no signal, and training graphs looked different from inference
    # graphs (where a new patient is only linked to variants they carry).
    for _, row in genomic_df.iterrows():
        if row["variant"] == "present":
            kg.add_patient_has_variant(row["patient_id"], row["gene"], row["variant"])

    for _, row in drug_gene_df.iterrows():
        kg.add_drug_metabolized_by_gene(row["drugname"], row["gene"])

    for _, row in gene_allergy_df.iterrows():
        kg.add_gene_associated_with_allergy(row["gene"], row["allergyname"])

    for _, row in patient_drug_allergy_df.iterrows():
        kg.add_drug_causes_adr(row["patientunitstayid"], row["drugname"], row["allergyname"])

    kg.deduplicate_and_validate()
    print(f"[kg.build] node type counts: {kg.node_type_counts()}")
    return kg


def visualize_graph(kg: GenomXKnowledgeGraph, out_path: str = "outputs/knowledge_graph.png", max_nodes: int = 220):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    G = kg.G
    H = G.subgraph(random.sample(list(G.nodes()), max_nodes)) if G.number_of_nodes() > max_nodes else G

    color_map = {"patient": "#10201C", "drug": "#C6432E", "allergy": "#C8801B",
                 "gene": "#6753D6", "variant": "#3A9E8C"}
    colors = [color_map.get(H.nodes[n].get("type"), "#9AA8A2") for n in H.nodes()]

    plt.figure(figsize=(10, 10))
    pos = nx.spring_layout(H, seed=42, k=0.3)
    nx.draw_networkx_edges(H, pos, alpha=0.2, width=0.5)
    nx.draw_networkx_nodes(H, pos, node_color=colors, node_size=45)
    plt.axis("off")
    plt.title(f"GenomX pharmacogenomic knowledge graph (sample of {H.number_of_nodes()} nodes)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=160)
    plt.close()
    print(f"[kg.visualize] saved figure to {out_path}")


if __name__ == "__main__":
    clinical_df = pd.read_csv("data/clinical_data.csv")
    genomic_df = pd.read_csv("data/genomic_variants.csv")
    pda_df = pd.read_csv("data/patient_drug_allergy.csv")
    drug_gene_df = pd.read_csv("data/drug_gene_metabolism.csv")
    gene_allergy_df = pd.read_csv("data/gene_allergy_association.csv")

    kg = build_knowledge_graph(clinical_df, genomic_df, pda_df, drug_gene_df, gene_allergy_df)
    visualize_graph(kg)
