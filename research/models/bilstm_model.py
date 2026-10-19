"""
models/bilstm_model.py
=================================================================
Algorithm 4: Bi-LSTM-Based Sequence Learning.

Learns long-range dependencies across a patient's ordered
pharmacogene panel (e.g. how a variant in one gene's metabolic
pathway interacts with another) by reading the sequence forward and
backward and concatenating both final hidden states into a single
embedding for the fusion network (Algorithm 6).
=================================================================
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score


class GenomicBiLSTM(nn.Module):
    """Embedding layer + Bi-LSTM layers (line 7); dropout regularization
    (line 8)."""

    def __init__(self, vocab_size: int, embed_dim: int = 16, hidden_size: int = 16,
                 embedding_out: int = 32, dropout: float = 0.3):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim)
        self.lstm = nn.LSTM(embed_dim, hidden_size, batch_first=True, bidirectional=True)
        self.dropout = nn.Dropout(dropout)
        self.fc_embed = nn.Linear(hidden_size * 2, embedding_out)
        self.classifier = nn.Linear(embedding_out, 1)

    def encode(self, token_seq):
        """Forward sequence propagation, backward sequence propagation,
        concatenate hidden states (lines 11-13). nn.LSTM with
        bidirectional=True already runs both directions internally and
        returns h_n stacked as (num_directions, N, hidden_size); we
        concatenate the forward and backward final states."""
        x = self.embedding(token_seq)               # (N, L, embed_dim)
        _, (h_n, _) = self.lstm(x)                   # h_n: (2, N, hidden_size)
        forward_h, backward_h = h_n[0], h_n[1]
        concat = torch.cat([forward_h, backward_h], dim=-1)   # (N, hidden_size*2)
        concat = self.dropout(concat)
        embedding = self.fc_embed(concat)
        return embedding

    def forward(self, token_seq):
        """Compute classification loss (line 14) via a small supervised
        head, same rationale as the CNN model: adr_risk is a weak label
        used only to shape a genomically-informed embedding space."""
        embedding = self.encode(token_seq)
        logits = self.classifier(embedding)
        return logits, embedding


def train_bilstm(seqs: np.ndarray, labels: np.ndarray, vocab_size: int, epochs: int = 40,
                  lr: float = 1e-3, seed: int = 42):
    torch.manual_seed(seed)
    from splits import holdout_indices
    train_idx, test_idx = holdout_indices(labels, seed=seed)
    X_train, X_test, y_train, y_test = seqs[train_idx], seqs[test_idx], labels[train_idx], labels[test_idx]
    model = GenomicBiLSTM(vocab_size=vocab_size)
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
            print(f"[bilstm.train] epoch {epoch:03d} loss={loss.item():.4f}")

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
    print("[bilstm.evaluate] " + "  ".join(f"{k}={v:.3f}" for k, v in metrics.items()))
    return model, history, metrics


def get_embeddings(model: GenomicBiLSTM, seqs: np.ndarray) -> np.ndarray:
    """Generate genomic sequence embeddings (line 19) for every patient."""
    model.eval()
    with torch.no_grad():
        _, embedding = model(torch.tensor(seqs, dtype=torch.long))
    return embedding.numpy() if hasattr(embedding, "numpy") else np.asarray(embedding)
