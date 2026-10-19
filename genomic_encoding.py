"""
genomic_encoding.py
=================================================================
Shared utility: turns the long-format genomic_variants.csv (one row
per patient x gene) into a fixed-length ordered integer sequence per
patient -- the input format both the CNN (Algorithm 3) and Bi-LSTM
(Algorithm 4) models expect.
=================================================================
"""

import numpy as np
import pandas as pd

from data_synthetic import GENE_PANEL

PAD_TOKEN = "<PAD>"
UNK_TOKEN = "<UNK>"


def build_vocab(genomic_df: pd.DataFrame):
    """Encode gene variants -- Algorithm 3/4, line 3: builds a token for
    every observed (gene, allele) combination."""
    tokens = sorted(set((genomic_df["gene"] + "::" + genomic_df["variant"]).unique()))
    vocab = {PAD_TOKEN: 0, UNK_TOKEN: 1}
    for t in tokens:
        vocab[t] = len(vocab)
    print(f"[genomic_encoding.build_vocab] {len(vocab)} tokens ({len(tokens)} observed gene:allele combos)")
    return vocab


def encode_sequences(genomic_df: pd.DataFrame, vocab: dict):
    """Pad sequences to equal length (Algorithm 4, line 4) -- here every
    patient already has one row per gene in GENE_PANEL, so the sequence
    length is fixed at len(GENE_PANEL) by construction; missing genes
    fall back to <UNK>."""
    wide = genomic_df.pivot(index="patient_id", columns="gene", values="variant")
    patient_ids = wide.index.tolist()
    seqs = np.zeros((len(patient_ids), len(GENE_PANEL)), dtype=np.int64)
    for i, gene in enumerate(GENE_PANEL):
        col = wide[gene] if gene in wide.columns else pd.Series(index=wide.index, dtype=object)
        for j, pid in enumerate(patient_ids):
            allele = col.get(pid)
            token = f"{gene}::{allele}" if pd.notna(allele) else None
            seqs[j, i] = vocab.get(token, vocab[UNK_TOKEN])
    print(f"[genomic_encoding.encode_sequences] sequence matrix shape {seqs.shape}")
    return patient_ids, seqs
