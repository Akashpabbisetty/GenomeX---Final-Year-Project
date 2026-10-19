"""
models/cnn_model.py
=================================================================
Algorithm 3: CNN-Based Pharmacogenomic Prediction.

Learns local mutation/variant-motif patterns across a patient's
pharmacogene panel (encoded as a short token sequence -- see
genomic_encoding.py) via 1D convolution, and outputs a genomic
embedding vector for the fusion network (Algorithm 6).

Requires torch (see requirements.txt / README validation-status note).
=================================================================
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score


class GenomicCNN(nn.Module):
    """Convolution, pooling and fully connected layers (line 7);
    dropout + batch norm for regularization (line 8)."""

    def __init__(self, vocab_size: int, seq_len: int, embed_dim: int = 16,
                 conv_channels: int = 32, embedding_out: int = 32, dropout: float = 0.3):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim)
        self.conv1 = nn.Conv1d(embed_dim, conv_channels, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm1d(conv_channels)
        self.pool = nn.MaxPool1d(kernel_size=2)
        self.dropout = nn.Dropout(dropout)
        pooled_len = seq_len // 2
        self.fc_embed = nn.Linear(conv_channels * pooled_len, embedding_out)
        self.classifier = nn.Linear(embedding_out, 1)

    def encode(self, token_seq):
        """Perform convolution + activation + max pooling + flatten
        (lines 11-14), returning the genomic embedding vector."""
        x = self.embedding(token_seq)      # (N, L, embed_dim)
        x = x.transpose(1, 2)              # (N, embed_dim, L) -- Conv1d expects channels-first
        x = self.conv1(x)
        x = F.relu(x)
        x = self.bn1(x)
        x = self.pool(x)
        x = self.dropout(x)
        x = x.flatten(1)                   # (N, conv_channels * pooled_len)
        embedding = self.fc_embed(x)
        return embedding

    def forward(self, token_seq):
        """Compute classification loss target (line 15) via a small
        supervised head on top of the embedding -- adr_risk is used as
        a weak label so the CNN learns a genomically meaningful space,
        not because genotype alone should ever be read as a diagnosis."""
        embedding = self.encode(token_seq)
        logits = self.classifier(embedding)
        return logits, embedding


def train_cnn(seqs: np.ndarray, labels: np.ndarray, vocab_size: int, epochs: int = 40,
              lr: float = 1e-3, seed: int = 42):
    torch.manual_seed(seed)
    from splits import holdout_indices
    train_idx, test_idx = holdout_indices(labels, seed=seed)
    X_train, X_test, y_train, y_test = seqs[train_idx], seqs[test_idx], labels[train_idx], labels[test_idx]
    model = GenomicCNN(vocab_size=vocab_size, seq_len=seqs.shape[1])
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)

    X_train_t = torch.tensor(X_train, dtype=torch.long)
    y_train_t = torch.tensor(y_train.reshape(-1, 1), dtype=torch.float)
    X_test_t = torch.tensor(X_test, dtype=torch.long)
    y_test_t = torch.tensor(y_test.reshape(-1, 1), dtype=torch.float)

    history = {"loss": []}
    for epoch in range(1, epochs + 1):
        model.train()
        optimizer.zero_grad()
        logits, _ = model(X_train_t)
        loss = F.binary_cross_entropy_with_logits(logits, y_train_t)
        loss.backward()
        optimizer.step()
        history["loss"].append(loss.item())
        if epoch % 10 == 0 or epoch == 1:
            print(f"[cnn.train] epoch {epoch:03d} loss={loss.item():.4f}")

    model.eval()
    with torch.no_grad():
        test_logits, _ = model(X_test_t)
        preds = (torch.sigmoid(test_logits) > 0.5).float().numpy().reshape(-1).astype(int)
    metrics = {
        "accuracy": accuracy_score(y_test, preds),
        "precision": precision_score(y_test, preds, zero_division=0),
        "recall": recall_score(y_test, preds, zero_division=0),
        "f1": f1_score(y_test, preds, zero_division=0),
    }
    print("[cnn.evaluate] " + "  ".join(f"{k}={v:.3f}" for k, v in metrics.items()))
    return model, history, metrics


def get_embeddings(model: GenomicCNN, seqs: np.ndarray) -> np.ndarray:
    """Output genomic feature embeddings (line 20) for every patient,
    to be handed to the fusion network."""
    model.eval()
    with torch.no_grad():
        _, embedding = model(torch.tensor(seqs, dtype=torch.long))
    return embedding.numpy() if hasattr(embedding, "numpy") else np.asarray(embedding)
