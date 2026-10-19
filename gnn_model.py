"""
gnn_model.py
=================================================================
Algorithm 8: GNN-Based Drug Allergy Recommendation System.

Same link-prediction GCN as the earlier standalone GenomX backend,
upgraded here to take its patient node features from the fusion
network (Algorithm 6) instead of a generic type+degree feature,
and to operate on the richer 5-node-type / 5-edge-type graph from
Algorithm 7 (patients, drugs, allergies, genes, variants).

Non-patient nodes (drug, allergy, gene, variant) don't have
multimodal patient data, so they get a zero-padded version of the
same simple type+degree feature used before, at the same width as
the fused patient embedding -- this keeps every node's feature
vector the same dimensionality, which GCNConv requires.
=================================================================
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.nn import GCNConv
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

from knowledge_graph import GenomXKnowledgeGraph


def generate_edge_index(G) -> torch.Tensor:
    edges = list(G.edges())
    src = [u for u, v in edges] + [v for u, v in edges]
    dst = [v for u, v in edges] + [u for u, v in edges]
    edge_index = torch.tensor([src, dst], dtype=torch.long)
    print(f"[gnn.generate_edge_index] edge_index shape {tuple(edge_index.shape)}")
    return edge_index


def create_node_features(kg: GenomXKnowledgeGraph, patient_embeddings: dict, embed_dim: int) -> torch.Tensor:
    """Build the node feature matrix: patient rows get their fused
    multimodal embedding (Algorithm 6 output); every other node type
    gets a zero-padded one-hot(type) + normalized-degree vector at the
    same width, so GCNConv sees a single consistent feature space."""
    G = kg.G
    n = G.number_of_nodes()
    x = np.zeros((n, embed_dim), dtype=np.float32)

    type_index = {"patient": 0, "drug": 1, "allergy": 2, "gene": 3, "variant": 4}
    max_deg = max(dict(G.degree()).values()) or 1

    for node_id, data in G.nodes(data=True):
        node_type = data["type"]
        label = data["label"]
        if node_type == "patient" and label in patient_embeddings:
            x[node_id, :] = patient_embeddings[label]
        else:
            # small structural fallback feature, zero-padded to embed_dim
            onehot_dim = len(type_index)
            x[node_id, type_index.get(node_type, 0)] = 1.0
            deg_col = onehot_dim  # place degree right after the one-hot block
            if deg_col < embed_dim:
                x[node_id, deg_col] = G.degree(node_id) / max_deg

    x_t = torch.tensor(x, dtype=torch.float)
    print(f"[gnn.create_node_features] node feature matrix shape {tuple(x_t.shape)}")
    return x_t


def convert_to_pytorch_geometric_format(kg: GenomXKnowledgeGraph, patient_embeddings: dict, embed_dim: int) -> Data:
    edge_index = generate_edge_index(kg.G)
    x = create_node_features(kg, patient_embeddings, embed_dim)
    return Data(x=x, edge_index=edge_index)


def build_link_prediction_splits(kg: GenomXKnowledgeGraph, seed: int = 42):
    """Positive edges = documented Drug-causes-ADR patient-drug pairs;
    negatives = sampled patient-drug pairs with no such edge."""
    rng = np.random.default_rng(seed)
    positives = [
        (u, v) for u, v, d in kg.G.edges(data=True) if d.get("relation") == "Drug-causes-ADR"
    ]
    patients = [nid for nid, d in kg.G.nodes(data=True) if d["type"] == "patient"]
    drugs = [nid for nid, d in kg.G.nodes(data=True) if d["type"] == "drug"]
    positive_set = set(map(tuple, (sorted(p) for p in positives)))

    negatives = set()
    target = len(positives)
    attempts = 0
    while len(negatives) < target and attempts < target * 20:
        p, d = int(rng.choice(patients)), int(rng.choice(drugs))
        pair = tuple(sorted((p, d)))
        if pair not in positive_set:
            negatives.add(pair)
        attempts += 1

    pos_arr = np.array(list(positive_set))
    neg_arr = np.array(list(negatives))
    all_pairs = np.concatenate([pos_arr, neg_arr], axis=0)
    all_labels = np.concatenate([np.ones(len(pos_arr)), np.zeros(len(neg_arr))]).astype(np.float32)

    train_pairs, temp_pairs, train_labels, temp_labels = train_test_split(
        all_pairs, all_labels, test_size=0.3, random_state=seed, stratify=all_labels
    )
    val_pairs, test_pairs, val_labels, test_labels = train_test_split(
        temp_pairs, temp_labels, test_size=0.5, random_state=seed, stratify=temp_labels
    )

    def to_t(pairs, labels):
        return torch.tensor(pairs.T, dtype=torch.long), torch.tensor(labels, dtype=torch.float)

    print(f"[gnn.splits] train={len(train_pairs)} val={len(val_pairs)} test={len(test_pairs)}")
    return {"train": to_t(train_pairs, train_labels), "val": to_t(val_pairs, val_labels), "test": to_t(test_pairs, test_labels)}


class DrugRecommendationGNN(nn.Module):
    def __init__(self, in_channels: int, hidden_channels: int = 64, out_channels: int = 32, dropout: float = 0.3):
        super().__init__()
        self.conv1 = GCNConv(in_channels, hidden_channels)
        self.conv2 = GCNConv(hidden_channels, out_channels)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.dropout(x)
        x = self.conv2(x, edge_index)
        return x

    def decode(self, z, edge_label_index):
        src, dst = edge_label_index
        return (z[src] * z[dst]).sum(dim=-1)


def train_gnn(data: Data, splits: dict, epochs: int = 80, lr: float = 0.01, weight_decay: float = 5e-4, seed: int = 42):
    torch.manual_seed(seed)
    model = DrugRecommendationGNN(in_channels=data.x.shape[1])
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)

    train_idx, train_labels = splits["train"]
    val_idx, val_labels = splits["val"]
    history = {"train_loss": [], "val_loss": [], "train_acc": [], "val_acc": []}

    for epoch in range(1, epochs + 1):
        model.train()
        optimizer.zero_grad()
        z = model(data.x, data.edge_index)
        logits = model.decode(z, train_idx)
        loss = F.binary_cross_entropy_with_logits(logits, train_labels)
        loss.backward()
        optimizer.step()

        train_pred = (torch.sigmoid(logits) > 0.5).float()
        train_acc = (train_pred == train_labels).float().mean().item()

        model.eval()
        with torch.no_grad():
            z_val = model(data.x, data.edge_index)
            val_logits = model.decode(z_val, val_idx)
            val_loss = F.binary_cross_entropy_with_logits(val_logits, val_labels).item()
            val_pred = (torch.sigmoid(val_logits) > 0.5).float()
            val_acc = (val_pred == val_labels).float().mean().item()

        history["train_loss"].append(loss.item()); history["val_loss"].append(val_loss)
        history["train_acc"].append(train_acc); history["val_acc"].append(val_acc)
        if epoch % 10 == 0 or epoch == 1:
            print(f"[gnn.train] epoch {epoch:03d} train_loss={loss.item():.4f} train_acc={train_acc:.3f} "
                  f"val_loss={val_loss:.4f} val_acc={val_acc:.3f}")

    return model, history


def evaluate_gnn(model, data: Data, edge_label_index, edge_label):
    model.eval()
    with torch.no_grad():
        z = model(data.x, data.edge_index)
        probs = torch.sigmoid(model.decode(z, edge_label_index)).numpy()
    preds = (probs > 0.5).astype(int)
    y_true = edge_label.numpy().astype(int)
    metrics = {
        "accuracy": accuracy_score(y_true, preds),
        "precision": precision_score(y_true, preds, zero_division=0),
        "recall": recall_score(y_true, preds, zero_division=0),
        "f1": f1_score(y_true, preds, zero_division=0),
    }
    print("[gnn.evaluate] " + "  ".join(f"{k}={v:.3f}" for k, v in metrics.items()))
    return metrics
