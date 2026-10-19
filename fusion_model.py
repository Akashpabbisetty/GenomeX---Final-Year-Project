"""
models/fusion_model.py
=================================================================
Algorithm 6: Multi-Modal Feature Fusion Network.

Combines Random Forest / XGBoost risk-probability signals with the
CNN genomic embedding, Bi-LSTM sequence embedding, and Autoencoder
latent representation into one unified per-patient embedding, using
a learned attention weight over each modality (so the network can
down-weight a modality that's less informative for a given patient
rather than treating all four as equally reliable).

The resulting embedding is what gets passed to the Graph Neural
Network (Algorithm 8) as each patient node's initial feature vector.
=================================================================
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class FusionNetwork(nn.Module):
    """Fully connected fusion layers (line 5) + attention mechanism
    (line 6)."""

    def __init__(self, modality_dims: dict, common_dim: int = 32, fused_dim: int = 32):
        super().__init__()
        self.modality_names = list(modality_dims.keys())
        # project every modality into a shared common_dim before attention,
        # since raw modality embeddings can have different widths
        self.projections = {
            name: nn.Linear(dim, common_dim) for name, dim in modality_dims.items()
        }
        self.attn_score = nn.Linear(common_dim, 1)
        self.fusion_head = nn.Sequential(
            nn.Linear(common_dim, common_dim), nn.ReLU(),
            nn.Linear(common_dim, fused_dim),
        )
        self.classifier = nn.Linear(fused_dim, 1)

    def parameters(self):
        params = []
        for p in self.projections.values():
            params.extend(p.parameters())
        params.extend(self.attn_score.parameters())
        params.extend(self.fusion_head.parameters())
        params.extend(self.classifier.parameters())
        return params

    def forward(self, modality_tensors: dict):
        """Normalize embedding vectors, concatenate/stack, apply
        attention, forward propagate fused features (lines 2-3, 6, 9)."""
        projected = [self.projections[name](modality_tensors[name]) for name in self.modality_names]
        stacked = torch.stack(projected, dim=1)             # (N, n_modalities, common_dim)

        n_modalities = len(self.modality_names)
        scores = [self.attn_score(projected[i]) for i in range(n_modalities)]  # each (N,1)
        scores_cat = torch.cat(scores, dim=1)               # (N, n_modalities)
        weights = F.softmax(scores_cat, dim=-1)             # (N, n_modalities)

        weights_expanded = weights.unsqueeze(-1)            # (N, n_modalities, 1)
        context = (stacked * weights_expanded).sum(dim=1)   # (N, common_dim)

        fused = self.fusion_head(context)                   # unified patient embedding
        logits = self.classifier(fused)
        return logits, fused, weights


def train_fusion(modality_arrays: dict, labels: np.ndarray, epochs: int = 60,
                  lr: float = 1e-3, fused_dim: int = 32, seed: int = 42):
    """modality_arrays: dict[name] -> np.ndarray of shape (N, dim_name),
    e.g. {"rf": (N,1), "xgb": (N,1), "cnn": (N,32), "bilstm": (N,32), "autoencoder": (N,8)}"""
    torch.manual_seed(seed)
    modality_dims = {name: arr.shape[1] for name, arr in modality_arrays.items()}
    model = FusionNetwork(modality_dims, fused_dim=fused_dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)

    tensors = {name: torch.tensor(arr, dtype=torch.float) for name, arr in modality_arrays.items()}
    y_t = torch.tensor(labels.reshape(-1, 1), dtype=torch.float)

    history = {"loss": []}
    for epoch in range(1, epochs + 1):
        model.train()
        optimizer.zero_grad()
        logits, _, _ = model(tensors)
        loss = F.binary_cross_entropy_with_logits(logits, y_t)   # fusion loss (line 10)
        loss.backward()                                          # backprop (line 11)
        optimizer.step()                                         # update parameters (line 12)
        history["loss"].append(loss.item())
        if epoch % 15 == 0 or epoch == 1:
            print(f"[fusion.train] epoch {epoch:03d} loss={loss.item():.4f}")

    return model, history


def get_fused_embeddings(model: FusionNetwork, modality_arrays: dict):
    """Generate unified patient embeddings (line 14), ready to be passed
    to the Graph Neural Network (line 15)."""
    model.eval()
    tensors = {name: torch.tensor(arr, dtype=torch.float) for name, arr in modality_arrays.items()}
    with torch.no_grad():
        _, fused, weights = model(tensors)
    fused_np = fused.numpy() if hasattr(fused, "numpy") else np.asarray(fused)
    weights_np = weights.numpy() if hasattr(weights, "numpy") else np.asarray(weights)
    return fused_np, weights_np
