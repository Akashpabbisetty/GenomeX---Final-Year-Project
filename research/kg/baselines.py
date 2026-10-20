"""
research/kg/baselines.py
=================================================================
FEAT-002 -- Classical (non-GNN) baselines for drug->ADR association
prediction. scikit-learn + numpy only; runs fully on the classical venv
(no torch/RDKit).

POSITIVE-UNLABELED (PU) CAVEAT -- read before using any of this:
    A (drug, cui) pair present in edges_drug_term is a POSITIVE label.
    A pair that is ABSENT is UNLABELED, NOT a confirmed negative -- SIDER
    records what a drug label reports, not an exhaustive true/false matrix.
    None of these baselines may treat absent pairs as true negatives.

    Where a baseline needs negatives to train (logistic regression, matrix
    factorisation), negatives are SAMPLED from the UNLABELED set as
    PSEUDO-negatives (uniform random (drug, term) pairs not seen as
    positives, `neg_ratio` of them per positive, fixed seed). This is the
    standard PU training device; it biases scores optimistically and that
    limitation belongs in the model card, not hidden here.

Baselines (each returns a model object + a score() path via predict_scores):
  - term_popularity_prior      global popularity of each term (drug-agnostic)
  - drug_similarity_knn        kNN over drug-drug similarity (gene-set Jaccard
                               now; structure Tanimoto when fingerprints exist)
  - logistic_regression_baseline  sklearn LogisticRegression on pair features
  - matrix_factorisation       numpy SGD latent factors with PU negatives

predict_scores(model, pairs) is the single scoring entry point used by
ablations/error-analysis; every model returned here carries a "kind" tag so
predict_scores can dispatch.

Function-based module with `[kg.base] ...` print-logging. Fixed seed 42.

Run (smoke print):
    research/kg/.venv/Scripts/python.exe research/kg/baselines.py
=================================================================
"""

import numpy as np
from sklearn.linear_model import LogisticRegression

SEED = 42


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _positive_set(train_edges):
    """Build a set of (drug_index, term_index) positive pairs from a 2-column
    array / list of (drug, term) rows."""
    arr = np.asarray(train_edges)
    if arr.ndim != 2 or arr.shape[1] < 2:
        raise ValueError("train_edges must be an (n,2+) array of (drug,term)")
    return {(int(r[0]), int(r[1])) for r in arr[:, :2]}


def sample_negatives(positives, n_drugs, n_terms, neg_ratio=1, seed=SEED):
    """Sample PSEUDO-negative (drug, term) pairs from the UNLABELED set.

    `positives` is a set of (drug_index, term_index). We draw
    neg_ratio * len(positives) uniform random pairs that are NOT positives.
    These are PU pseudo-negatives, not confirmed negatives (see module
    docstring). Returns an (m, 2) int array.
    """
    rng = np.random.default_rng(seed)
    n_neg = int(neg_ratio * len(positives))
    negs = set()
    # rejection sampling against the positive set; cap attempts defensively
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
    print(f"[kg.base.sample_negatives] drew {len(out)} PU pseudo-negatives "
          f"(ratio={neg_ratio}, from unlabeled; absent != negative)")
    return out


# --------------------------------------------------------------------------
# 1. term-popularity prior
# --------------------------------------------------------------------------

def term_popularity_prior(train_edges, n_terms):
    """Drug-agnostic prior: each term scored by how many training drugs list
    it, normalised to [0,1]. Returns a model dict {kind, term_prior} whose
    score for any (drug, term) is term_prior[term].
    """
    arr = np.asarray(train_edges)
    counts = np.zeros(n_terms, dtype=float)
    if arr.size:
        term_idx, c = np.unique(arr[:, 1].astype(int), return_counts=True)
        counts[term_idx] = c
    prior = counts / counts.max() if counts.max() > 0 else counts
    print(f"[kg.base.term_popularity_prior] n_terms={n_terms} "
          f"nonzero={int((counts > 0).sum())} max_count={int(counts.max())}")
    return {"kind": "term_popularity", "term_prior": prior}


# --------------------------------------------------------------------------
# 2. drug-similarity kNN
# --------------------------------------------------------------------------

def gene_jaccard_similarity(drug_gene_edges, n_drugs):
    """Dense (n_drugs, n_drugs) gene-set Jaccard similarity from
    edges_drug_gene rows (drug_index, gene_index). Used as `drug_sim` for
    drug_similarity_knn when structure fingerprints are absent.
    """
    arr = np.asarray(drug_gene_edges)
    gene_sets = [set() for _ in range(n_drugs)]
    for r in arr:
        gene_sets[int(r[0])].add(int(r[1]))
    sim = np.zeros((n_drugs, n_drugs), dtype=float)
    for i in range(n_drugs):
        gi = gene_sets[i]
        if not gi:
            continue
        for j in range(i, n_drugs):
            gj = gene_sets[j]
            if not gj:
                continue
            inter = len(gi & gj)
            if inter == 0:
                continue
            union = len(gi | gj)
            s = inter / union
            sim[i, j] = s
            sim[j, i] = s
    print(f"[kg.base.gene_jaccard_similarity] n_drugs={n_drugs} "
          f"nonzero_pairs={int((sim > 0).sum())}")
    return sim


def drug_similarity_knn(train_edges, drug_sim, n_terms, k=25):
    """kNN over drug-drug similarity. A (drug d, term t) is scored by the
    similarity-weighted fraction of d's top-k most similar TRAINING drugs
    that list term t.

    `drug_sim` is a dense (n_drugs, n_drugs) similarity matrix -- gene-set
    Jaccard today, structure Tanimoto when fingerprints exist (same shape, so
    this function is agnostic to the basis). Returns a model dict
    {kind, pos_by_drug, drug_sim, k, n_terms}.
    """
    positives = _positive_set(train_edges)
    pos_by_drug = {}
    for (d, t) in positives:
        pos_by_drug.setdefault(d, set()).add(t)
    print(f"[kg.base.drug_similarity_knn] k={k} train_drugs={len(pos_by_drug)} "
          f"sim_shape={np.asarray(drug_sim).shape}")
    return {
        "kind": "drug_knn",
        "pos_by_drug": pos_by_drug,
        "drug_sim": np.asarray(drug_sim, dtype=float),
        "k": int(k),
        "n_terms": int(n_terms),
    }


# --------------------------------------------------------------------------
# 3. logistic regression
# --------------------------------------------------------------------------

def logistic_regression_baseline(features, train_edges, n_drugs, n_terms,
                                 neg_ratio=1, seed=SEED, C=1.0):
    """Logistic regression on per-pair features.

    `features(drug_index, term_index) -> 1d np.ndarray` is a callable that
    produces a feature vector for a pair (lets callers plug in drug/term
    embeddings, popularity, tggates scalars, etc.). Positives come from
    train_edges; negatives are PU pseudo-negatives sampled from the unlabeled
    set (see module docstring). Returns a model dict
    {kind, clf, features}.
    """
    positives = _positive_set(train_edges)
    pos = np.array(sorted(positives), dtype=np.int64)
    neg = sample_negatives(positives, n_drugs, n_terms, neg_ratio, seed)

    pairs = np.vstack([pos, neg]) if len(neg) else pos
    y = np.concatenate([np.ones(len(pos)), np.zeros(len(neg))]).astype(int)
    X = np.vstack([features(int(d), int(t)) for d, t in pairs])

    clf = LogisticRegression(max_iter=1000, C=C, random_state=seed)
    clf.fit(X, y)
    print(f"[kg.base.logistic_regression_baseline] fit on {len(pos)} pos + "
          f"{len(neg)} PU-neg, n_features={X.shape[1]}")
    return {"kind": "logreg", "clf": clf, "features": features}


# --------------------------------------------------------------------------
# 4. matrix factorisation (numpy SGD)
# --------------------------------------------------------------------------

def matrix_factorisation(train_edges, n_drugs, n_terms, dim=64, seed=SEED,
                         neg_ratio=1, lr=0.05, reg=0.01, epochs=30):
    """Numpy SGD matrix factorisation with PU negative sampling.

    Learns drug factors D (n_drugs, dim) and term factors T (n_terms, dim) so
    that sigmoid(D[d] . T[t]) predicts a positive. Positives are train_edges;
    negatives are SAMPLED from the UNLABELED set each run (PU-aware -- absent
    pairs are not treated as confirmed negatives, only as a sampled
    pseudo-negative background). Returns a model dict {kind, D, T}.
    """
    rng = np.random.default_rng(seed)
    positives = _positive_set(train_edges)
    pos = np.array(sorted(positives), dtype=np.int64)
    neg = sample_negatives(positives, n_drugs, n_terms, neg_ratio, seed)

    pairs = np.vstack([pos, neg]) if len(neg) else pos
    labels = np.concatenate([np.ones(len(pos)), np.zeros(len(neg))]).astype(float)

    scale = 0.1
    D = rng.normal(0.0, scale, size=(n_drugs, dim))
    T = rng.normal(0.0, scale, size=(n_terms, dim))

    n = len(pairs)
    for ep in range(epochs):
        order = rng.permutation(n)
        total_loss = 0.0
        for idx in order:
            d, t = int(pairs[idx, 0]), int(pairs[idx, 1])
            y = labels[idx]
            dot = float(D[d] @ T[t])
            # numerically stable sigmoid
            pred = 1.0 / (1.0 + np.exp(-dot))
            err = pred - y
            # eps for logloss accumulation
            total_loss += -(y * np.log(pred + 1e-12) + (1 - y) * np.log(1 - pred + 1e-12))
            gd = err * T[t] + reg * D[d]
            gt = err * D[d] + reg * T[t]
            D[d] -= lr * gd
            T[t] -= lr * gt
        if ep == 0 or ep == epochs - 1:
            print(f"[kg.base.matrix_factorisation] epoch {ep + 1}/{epochs} "
                  f"mean_logloss={total_loss / n:.4f}")
    print(f"[kg.base.matrix_factorisation] dim={dim} drugs={n_drugs} "
          f"terms={n_terms} pos={len(pos)} PU-neg={len(neg)}")
    return {"kind": "mf", "D": D, "T": T}


# --------------------------------------------------------------------------
# unified scoring
# --------------------------------------------------------------------------

def predict_scores(model, pairs):
    """Score a batch of (drug_index, term_index) pairs with any baseline model
    returned above. `pairs` is an (n, 2) array/list. Returns a 1d np.ndarray of
    finite scores aligned to `pairs`.
    """
    pairs = np.asarray(pairs)
    kind = model["kind"]

    if kind == "term_popularity":
        prior = model["term_prior"]
        scores = prior[pairs[:, 1].astype(int)]

    elif kind == "drug_knn":
        sim = model["drug_sim"]
        pos_by_drug = model["pos_by_drug"]
        k = model["k"]
        train_drugs = np.array(sorted(pos_by_drug.keys()), dtype=int)
        scores = np.zeros(len(pairs), dtype=float)
        for i, (d, t) in enumerate(pairs):
            d, t = int(d), int(t)
            if len(train_drugs) == 0:
                continue
            sims = sim[d, train_drugs]
            kk = min(k, len(train_drugs))
            top = np.argsort(-sims, kind="stable")[:kk]
            top_drugs = train_drugs[top]
            top_sims = sims[top]
            denom = top_sims.sum()
            if denom <= 0:
                continue
            num = sum(w for dj, w in zip(top_drugs, top_sims)
                      if t in pos_by_drug.get(int(dj), ()))
            scores[i] = num / denom

    elif kind == "logreg":
        clf = model["clf"]
        feats = model["features"]
        X = np.vstack([feats(int(d), int(t)) for d, t in pairs])
        scores = clf.predict_proba(X)[:, 1]

    elif kind == "mf":
        D, T = model["D"], model["T"]
        d_idx = pairs[:, 0].astype(int)
        t_idx = pairs[:, 1].astype(int)
        dots = np.einsum("ij,ij->i", D[d_idx], T[t_idx])
        scores = 1.0 / (1.0 + np.exp(-dots))

    else:
        raise ValueError(f"unknown model kind: {kind!r}")

    scores = np.asarray(scores, dtype=float)
    print(f"[kg.base.predict_scores] kind={kind} n_pairs={len(pairs)} "
          f"score_range=({np.nanmin(scores):.4f},{np.nanmax(scores):.4f})")
    return scores


def main():
    """Smoke print over a tiny synthetic graph."""
    n_drugs, n_terms = 8, 6
    # synthetic positives
    train_edges = np.array([
        [0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [3, 3], [4, 4], [5, 5], [6, 0],
    ])
    drug_gene = np.array([[0, 0], [1, 0], [1, 1], [2, 1], [3, 2], [4, 2]])

    tp = term_popularity_prior(train_edges, n_terms)
    sim = gene_jaccard_similarity(drug_gene, n_drugs)
    knn = drug_similarity_knn(train_edges, sim, n_terms, k=3)

    def feats(d, t):
        return np.array([float(d), float(t), tp["term_prior"][t]])

    lr = logistic_regression_baseline(feats, train_edges, n_drugs, n_terms, seed=SEED)
    mf = matrix_factorisation(train_edges, n_drugs, n_terms, dim=8, epochs=10, seed=SEED)

    probe = np.array([[0, 0], [1, 2], [7, 5]])
    for name, m in [("popularity", tp), ("knn", knn), ("logreg", lr), ("mf", mf)]:
        s = predict_scores(m, probe)
        print(f"[kg.base] smoke {name} scores = {np.round(s, 3)}")


if __name__ == "__main__":
    main()
