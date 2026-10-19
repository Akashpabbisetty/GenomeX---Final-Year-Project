"""
models/autoencoder_model.py
=================================================================
Algorithm 5: Autoencoder-Based Feature Extraction.

Compresses the clinical feature matrix (and optionally any
concatenated genomic summary features) into a low-dimensional latent
representation via unsupervised reconstruction -- a complementary,
label-free signal for the fusion network (Algorithm 6), useful
because it captures structure in the data that a label-driven model
might miss or overfit to.
=================================================================
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class FeatureAutoencoder(nn.Module):
    """Encoder and decoder layers with a bottleneck latent dimension
    (lines 5-6)."""

    def __init__(self, input_dim: int, latent_dim: int = 8, hidden_dim: int = 16):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim), nn.ReLU(),
            nn.Linear(hidden_dim, latent_dim),
        )
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, hidden_dim), nn.ReLU(),
            nn.Linear(hidden_dim, input_dim),
        )

    def forward(self, x):
        """Encode input features, compress into latent space, reconstruct
        original input (lines 9-11)."""
        latent = self.encoder(x)
        reconstruction = self.decoder(latent)
        return reconstruction, latent


def train_autoencoder(X: np.ndarray, epochs: int = 60, lr: float = 1e-3,
                       latent_dim: int = 8, seed: int = 42):
    torch.manual_seed(seed)
    model = FeatureAutoencoder(input_dim=X.shape[1], latent_dim=latent_dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)
    X_t = torch.tensor(X, dtype=torch.float)

    history = {"loss": []}
    for epoch in range(1, epochs + 1):
        model.train()
        optimizer.zero_grad()
        reconstruction, _ = model(X_t)
        loss = F.mse_loss(reconstruction, X_t)   # reconstruction loss (line 12)
        loss.backward()                          # backprop reconstruction error (line 13)
        optimizer.step()                         # update model parameters (line 14)
        history["loss"].append(loss.item())
        if epoch % 15 == 0 or epoch == 1:
            print(f"[autoencoder.train] epoch {epoch:03d} reconstruction_mse={loss.item():.4f}")

    return model, history


def get_latent_embeddings(model: FeatureAutoencoder, X: np.ndarray) -> np.ndarray:
    """Extract latent feature embeddings (line 16) for every patient."""
    model.eval()
    with torch.no_grad():
        _, latent = model(torch.tensor(X, dtype=torch.float))
    return latent.numpy() if hasattr(latent, "numpy") else np.asarray(latent)
