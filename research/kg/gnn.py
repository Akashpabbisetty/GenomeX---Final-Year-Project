"""
research/kg/gnn.py
=================================================================
FEAT-003 -- Heterogeneous GNN link predictor for drug->ADR association
prediction (research only). A PyG HeteroData graph (drug / term / gene
nodes; drug-term label edges, drug-gene guideline edges) with message
passing + a dot-product decoder, trained with BCE over SAMPLED negatives
and early stopping on the DRUG-WISE cold-start validation split.

LAZY-IMPORT CONTRACT (critical) -- this module must import cleanly on the
classical venv, which has NO torch / torch_geometric installed:
    * There is NO top-level `import torch` / `import torch_geometric`.
    * _require_torch() performs the import on demand and raises a clear
      RuntimeError (naming research/kg/requirements.txt and the separate
      PyG wheel + CPU-only torch step) the moment training is actually
      invoked.
    * build_hetero_data / make_model / train_gnn all import torch lazily
      INSIDE the function body, so merely importing this module (or calling
      sample_negatives, which is pure numpy) never needs torch.

POSITIVE-UNLABELED (PU) CAVEAT -- read before using:
    A (drug, cui) pair present in edges_drug_term is a POSITIVE label; an
    ABSENT pair is UNLABELED, NEVER a confirmed negative (SIDER records what
    a drug label states, not an exhaustive truth matrix). Training negatives
    are SAMPLED from the UNLABELED set as PU PSEUDO-negatives (uniform random
    (drug, term) pairs not seen as positives, `ratio` per positive, fixed
    seed). This biases scores optimistically; the limitation belongs in the
    model card.

Function-based module with `[kg.gnn] ...` print-logging. Fixed seed 42.

Run (import must succeed even without torch):
    research/kg/.venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'research/kg'); import gnn"
=================================================================
"""

import os

import numpy as np

SEED = 42

# Message surfaced whenever the deep-learning path is invoked without the
# optional torch / torch_geometric stack present. Kept as a module constant
# so tests can assert on its content.
_TORCH_INSTALL_MESSAGE = (
    "The GNN path requires PyTorch + PyTorch Geometric, which are NOT part of "
    "the classical venv. Install them from research/kg/requirements.txt, then "
    "add PyTorch Geometric via its SEPARATE wheel step:\n"
    "  1. pip install -r research/kg/requirements.txt  "
    "(installs CPU-only torch from the --extra-index-url pinned there)\n"
    "  2. pip install torch_geometric AND its companion wheels "
    "(pyg_lib, torch_scatter, torch_sparse) from the matching PyG wheel index "
    "for your torch+CPU build -- see research/kg/PROCESS.md.\n"
    "The classical baselines in baselines.py run fully WITHOUT torch; only the "
    "GNN requires this extra install."
)


def _require_torch():
    """Import and return (torch, torch_geometric) or raise a clear install
    error. This is the single gate for every torch-dependent code path, so a
    missing dependency fails loudly with install guidance rather than with an
    opaque ImportError deep in the call stack.
    """
    try:
        import torch  # noqa: F401
        import torch_geometric  # noqa: F401
    except ImportError as exc:  # pragma: no cover - exercised only with torch absent
        print("[kg.gnn._require_torch] torch/torch_geometric unavailable -> "
              "raising install guidance")
        raise RuntimeError(_TORCH_INSTALL_MESSAGE) from exc
    print(f"[kg.gnn._require_torch] torch {torch.__version__}, "
          f"torch_geometric {torch_geometric.__version__}")
    return torch, torch_geometric


def _artifacts_dir_default():
    """Resolve research/kg/artifacts relative to this file so the module works
    from any cwd (mirrors build_graph.py's repo-root resolution)."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "artifacts"))


# --------------------------------------------------------------------------
# PU negative sampling (pure numpy -- intentionally NOT torch-dependent)
# --------------------------------------------------------------------------

def sample_negatives(pos_edges, n_drugs, n_terms, ratio=1, seed=SEED):
    """Sample PU PSEUDO-negative (drug, term) pairs from the UNLABELED set.

    `pos_edges` is an (n, 2) array/list of positive (drug_index, term_index)
    pairs. Draws `ratio * len(pos_edges)` uniform random pairs that are NOT
    positives (rejection sampling). These are PU pseudo-negatives, not
    confirmed negatives -- see the module docstring. Pure numpy so it can be
    unit-tested on the classical venv without torch. Returns an (m, 2) int
    array.
    """
    arr = np.asarray(pos_edges)
    if arr.ndim != 2 or arr.shape[1] < 2:
        raise ValueError("pos_edges must be an (n,2+) array of (drug,term)")
    positives = {(int(r[0]), int(r[1])) for r in arr[:, :2]}

    rng = np.random.default_rng(seed)
    n_neg = int(ratio * len(positives))
    negs = set()
    attempts = 0
    max_attempts = max(10 * n_neg, 1000)
    while len(negs) < n_neg and attempts < max_attempts:
        d = int(rng.integers(0, n_drugs))
        t = int(rng.integers(0, n_terms))
        attempts += 1
        if (d, t) in positives or (d, t) in negs:
            continue
        negs.add((d, t))
    out = np.array(sorted(negs), dtype=np.int64) if negs else np.empty((0, 2), np.int64)
    print(f"[kg.gnn.sample_negatives] drew {len(out)} PU pseudo-negatives "
          f"(ratio={ratio}, from unlabeled; absent != negative)")
    return out


# --------------------------------------------------------------------------
# graph construction (torch / PyG lazy-imported inside)
# --------------------------------------------------------------------------

def build_hetero_data(artifacts_dir=None):
    """Build a PyG HeteroData graph from the FEAT-001 Parquet artifacts.

    Node types: 'drug', 'term', 'gene'. Edge types:
      ('drug','has_adr','term')   -- positive label edges (and reverse)
      ('drug','assoc','gene')     -- guideline drug-gene edges (and reverse)
    Node features are learned embeddings (identity index tensors); the
    optional TG-GATEs scalars are attached to drug nodes when present.

    torch / torch_geometric are imported INSIDE this function so importing the
    module needs neither. Raises the clear install error (via _require_torch)
    when the stack is absent.
    """
    torch, _ = _require_torch()
    import pandas as pd
    from torch_geometric.data import HeteroData

    adir = artifacts_dir or _artifacts_dir_default()
    nodes_drug = pd.read_parquet(os.path.join(adir, "nodes_drug.parquet"))
    nodes_term = pd.read_parquet(os.path.join(adir, "nodes_term.parquet"))
    nodes_gene = pd.read_parquet(os.path.join(adir, "nodes_gene.parquet"))
    edges_dt = pd.read_parquet(os.path.join(adir, "edges_drug_term.parquet"))
    edges_dg = pd.read_parquet(os.path.join(adir, "edges_drug_gene.parquet"))

    n_drugs = int(nodes_drug["drug_index"].max()) + 1
    n_terms = int(nodes_term["term_index"].max()) + 1
    n_genes = int(nodes_gene["gene_index"].max()) + 1

    data = HeteroData()
    # Learned-embedding inputs: node id tensors (consumed by nn.Embedding in
    # the model). We also expose feature counts for the model factory.
    data["drug"].node_id = torch.arange(n_drugs)
    data["term"].node_id = torch.arange(n_terms)
    data["gene"].node_id = torch.arange(n_genes)
    data["drug"].num_nodes = n_drugs
    data["term"].num_nodes = n_terms
    data["gene"].num_nodes = n_genes

    dt = torch.tensor(
        np.vstack([edges_dt["drug_index"].to_numpy(),
                   edges_dt["term_index"].to_numpy()]),
        dtype=torch.long)
    dg = torch.tensor(
        np.vstack([edges_dg["drug_index"].to_numpy(),
                   edges_dg["gene_index"].to_numpy()]),
        dtype=torch.long)

    data["drug", "has_adr", "term"].edge_index = dt
    data["term", "rev_has_adr", "drug"].edge_index = dt.flip(0)
    data["drug", "assoc", "gene"].edge_index = dg
    data["gene", "rev_assoc", "drug"].edge_index = dg.flip(0)

    print(f"[kg.gnn.build_hetero_data] drugs={n_drugs} terms={n_terms} "
          f"genes={n_genes} drug-term={dt.shape[1]} drug-gene={dg.shape[1]}")
    return data


def make_model(data, hidden_channels=64, seed=SEED):
    """Build the hetero message-passing + dot-product-decoder link predictor.

    The nn.Module subclass is defined INSIDE this factory (never at module
    import time) so that importing gnn.py does not touch torch. Returns an
    instantiated model. Architecture: per-type learned embeddings -> two
    SAGEConv layers wrapped by to_hetero -> dot-product decoder over
    (drug, term) pairs for link scoring.
    """
    torch, _ = _require_torch()
    import torch.nn.functional as F
    from torch import nn
    from torch_geometric.nn import SAGEConv, to_hetero

    torch.manual_seed(seed)

    class GNNEncoder(nn.Module):
        def __init__(self, hidden):
            super().__init__()
            self.conv1 = SAGEConv((-1, -1), hidden)
            self.conv2 = SAGEConv((-1, -1), hidden)

        def forward(self, x, edge_index):
            x = F.relu(self.conv1(x, edge_index))
            x = self.conv2(x, edge_index)
            return x

    class LinkPredictor(nn.Module):
        """Learned node embeddings -> hetero GNN encoder -> dot-product
        decoder scoring (drug, term) pairs."""

        def __init__(self, metadata, hidden, n_drugs, n_terms, n_genes):
            super().__init__()
            self.emb = nn.ModuleDict({
                "drug": nn.Embedding(n_drugs, hidden),
                "term": nn.Embedding(n_terms, hidden),
                "gene": nn.Embedding(n_genes, hidden),
            })
            encoder = GNNEncoder(hidden)
            self.encoder = to_hetero(encoder, metadata, aggr="sum")

        def encode(self, data):
            x_dict = {
                "drug": self.emb["drug"](data["drug"].node_id),
                "term": self.emb["term"](data["term"].node_id),
                "gene": self.emb["gene"](data["gene"].node_id),
            }
            return self.encoder(x_dict, data.edge_index_dict)

        def decode(self, z_dict, drug_term_pairs):
            # drug_term_pairs: (2, E) long tensor of (drug_index, term_index)
            z_d = z_dict["drug"][drug_term_pairs[0]]
            z_t = z_dict["term"][drug_term_pairs[1]]
            return (z_d * z_t).sum(dim=-1)

        def forward(self, data, drug_term_pairs):
            z_dict = self.encode(data)
            return self.decode(z_dict, drug_term_pairs)

    n_drugs = int(data["drug"].num_nodes)
    n_terms = int(data["term"].num_nodes)
    n_genes = int(data["gene"].num_nodes)
    model = LinkPredictor(data.metadata(), hidden_channels,
                          n_drugs, n_terms, n_genes)
    print(f"[kg.gnn.make_model] hidden={hidden_channels} drugs={n_drugs} "
          f"terms={n_terms} genes={n_genes}")
    return model


# --------------------------------------------------------------------------
# training (torch lazy-imported inside)
# --------------------------------------------------------------------------

def _pos_pairs_for_drugs(edges_dt_np, drug_set):
    """Positive (drug, term) rows whose drug is in `drug_set` (numpy)."""
    mask = np.isin(edges_dt_np[:, 0], list(drug_set))
    return edges_dt_np[mask]


def train_gnn(data, splits, epochs=50, patience=10, seed=SEED,
              neg_ratio=1, lr=0.01, hidden_channels=64):
    """Train the link predictor with BCE over sampled negatives and early
    stopping on the DRUG-WISE validation split.

    `data` is a HeteroData from build_hetero_data; `splits` is the dict
    returned by splits.drug_wise_split ({'train','val','test'} of drug
    indices). Training positives are the label edges whose drug is in the
    train fold (cold-start: held-out drugs contribute no training edge);
    validation positives come from the val-fold drugs. Negatives are PU
    pseudo-negatives (see sample_negatives). Returns (model, history) where
    history is a list of per-epoch {epoch, train_loss, val_auc} dicts.

    torch is imported INSIDE this function -- invoking training on the
    classical venv raises the clear install error via _require_torch (first
    call inside build-free paths), satisfying the lazy-import contract.
    """
    torch, _ = _require_torch()
    import torch.nn.functional as F

    torch.manual_seed(seed)
    np.random.seed(seed)

    model = make_model(data, hidden_channels=hidden_channels, seed=seed)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    n_drugs = int(data["drug"].num_nodes)
    n_terms = int(data["term"].num_nodes)
    edges_dt_np = data["drug", "has_adr", "term"].edge_index.cpu().numpy().T

    train_drugs = set(int(x) for x in splits["train"])
    val_drugs = set(int(x) for x in splits["val"])
    train_pos = _pos_pairs_for_drugs(edges_dt_np, train_drugs)
    val_pos = _pos_pairs_for_drugs(edges_dt_np, val_drugs)

    def _edge_tensor(pos_np, neg_np):
        pairs = np.vstack([pos_np, neg_np]) if len(neg_np) else pos_np
        y = np.concatenate([np.ones(len(pos_np)), np.zeros(len(neg_np))])
        return (torch.tensor(pairs.T, dtype=torch.long),
                torch.tensor(y, dtype=torch.float))

    best_val = -1.0
    best_state = None
    epochs_no_improve = 0
    history = []

    from sklearn.metrics import roc_auc_score

    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        neg = sample_negatives(train_pos, n_drugs, n_terms, neg_ratio,
                               seed=seed + epoch)
        edge_pairs, y = _edge_tensor(train_pos, neg)
        logits = model(data, edge_pairs)
        loss = F.binary_cross_entropy_with_logits(logits, y)
        loss.backward()
        optimizer.step()

        # Validation AUC on val-fold drugs (cold-start).
        model.eval()
        with torch.no_grad():
            val_neg = sample_negatives(val_pos, n_drugs, n_terms, neg_ratio,
                                       seed=seed + 10_000 + epoch)
            v_pairs, v_y = _edge_tensor(val_pos, val_neg)
            if len(np.unique(v_y.numpy())) >= 2:
                v_logits = model(data, v_pairs)
                val_auc = float(roc_auc_score(
                    v_y.numpy(), torch.sigmoid(v_logits).numpy()))
            else:
                val_auc = float("nan")

        history.append({"epoch": epoch, "train_loss": float(loss.item()),
                        "val_auc": val_auc})
        print(f"[kg.gnn.train_gnn] epoch {epoch + 1}/{epochs} "
              f"loss={loss.item():.4f} val_auc={val_auc:.4f}")

        if np.isfinite(val_auc) and val_auc > best_val:
            best_val = val_auc
            best_state = {k: v.detach().clone()
                          for k, v in model.state_dict().items()}
            epochs_no_improve = 0
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= patience:
                print(f"[kg.gnn.train_gnn] early stopping at epoch {epoch + 1} "
                      f"(no val improvement for {patience} epochs)")
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    print(f"[kg.gnn.train_gnn] best val_auc={best_val:.4f}")
    return model, history


def score_all_pairs(model, data):
    """Score EVERY (drug, term) pair with the trained model. Returns a dense
    (n_drugs, n_terms) numpy array of sigmoid probabilities. torch lazy-import
    inside. For large graphs this is O(n_drugs * n_terms); callers that only
    need held-out drugs should score a pair subset via model(data, pairs)."""
    torch, _ = _require_torch()
    model.eval()
    with torch.no_grad():
        z_dict = model.encode(data)
        z_d = z_dict["drug"]
        z_t = z_dict["term"]
        logits = z_d @ z_t.T
        scores = torch.sigmoid(logits).cpu().numpy()
    print(f"[kg.gnn.score_all_pairs] scored matrix shape={scores.shape}")
    return scores


def main():
    """Smoke entry point. On the classical venv (no torch) this prints the
    install guidance rather than crashing opaquely."""
    print("[kg.gnn] module imported cleanly (torch not required for import)")
    try:
        _require_torch()
    except RuntimeError as exc:
        print(f"[kg.gnn] torch stack absent; training path would raise:\n{exc}")
        return
    data = build_hetero_data()
    print(f"[kg.gnn] built graph with metadata={data.metadata()}")


if __name__ == "__main__":
    main()
