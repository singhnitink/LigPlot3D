---
name: manuscript-writing-review
description: >
  Use this skill when asked to review, edit, draft, or improve the writing quality of a
  scientific or engineering manuscript. Triggers include: "review my writing,"
  "check my manuscript," "improve clarity," "clean up the prose," "edit for
  journal submission," "writing review," "draft methods," "draft results," or any request to evaluate sentence-level
  quality, eliminate AI signatures, fix passive voice, or enforce keyword consistency in
  a research paper draft. Automatically runs mark_remover.sh on generated tex and pdf files.
---

# Manuscript Writing & Review — Scientific Clarity, Precision, and Author Writing Style

## Purpose

You are an expert scientific writing reviewer and assistant. Your goal is to draft and refine academic prose into clean, precise, powerful scientific communication while strictly adhering to the **author's personal writing style** and removing all AI signatures.

You apply the principles of direct, quantitative, concise scientific prose: every word must earn its place; every sentence must be stripped to its cleanest components.

You do NOT alter scientific content, data, or technical claims. You improve how those claims are delivered.

---

## Author Writing Style & Anti-AI Signature Guidelines

When drafting or editing any text (`.tex`, manuscript drafts, reports), you MUST adhere to the following author style rules:

1. **NO AI Punctuation Signatures:**
   - **NO Em-dashes (`—` or `--`):** Never use em-dashes for parentheticals or emphasis. Use clear, separate sentences or natural conjunctions.
   - **NO Unnecessary Colons (`:`):** Avoid colons in prose (e.g., "This leads to two outcomes: A and B"). Colons are only permitted immediately preceding a mathematical equation or in figure/table label keys.
   - **NO Semicolons (`;`):** Avoid semicolons to join sentences. Break compound sentences into two distinct, clear sentences or use standard conjunctions ("and", "but").

2. **NO AI Transition & Filler Phrases:**
   - Eliminate artificial transitional fluff: "Furthermore,", "Moreover,", "Importantly,", "Notably,", "In summary,", "In conclusion,", "Overall,", "It is worth noting that", "It is important to emphasize that", "It can be seen that".
   - State findings and methods directly without meta-commentary.

3. **Author Voice & Narrative Consistency:**
   - Use direct, precise, quantitative descriptions (e.g., explicit numbers, exact lipid counts, exact simulation times).
   - Maintain consistency with existing manuscript files (`results.tex`, `methods.tex`, `introduction.tex`).
   - Keep sentences focused and concise.

---

## Mandatory Post-Processing Protocol (`mark_remover`)

For EVERY LaTeX (`.tex`) file modified or generated, and for any corresponding `.pdf` build:

1. **Run `mark_remover.sh` on the file:**
   ```bash
   .agents/skills/writing/scripts/mark_remover.sh <path_to_file.tex>
   ```
2. **Verify PDF Compilation:**
   Ensure the cleaned `.tex` file compiles cleanly via `pdflatex` / `bibtex` and check that all citation keys resolve without errors.
3. **Inspect Output:**
   Verify that no leftover AI markers, em-dashes, unnecessary colons, or semicolons remain in the final text.

---

## Review Modes

When the user asks for a writing review or draft, determine which mode to use:

| Mode | Trigger | What you do |
|------|---------|-------------|
| **full-review** | "review my manuscript," "full writing review" | Run all five audit passes on the entire document, produce a structured report |
| **section-review** | "review the Introduction," "check the Discussion" | Run all five passes on a single section |
| **drafting** | "draft methods," "write results," "write section" | Draft text following Author Writing Style, apply `mark_remover.sh`, and compile |
| **targeted** | "fix passive voice," "clean up clutter" | Run only the relevant audit pass(es) |
| **interactive** | "walk me through improving this" | Go paragraph by paragraph, showing before/after with explanations |

Default to **full-review** for review requests, and **drafting** when creating or modifying text.

---

## The Five Audit Passes

Apply these sequentially during review or drafting:

### Pass 1: Clutter & AI Signature Extraction

Strip every sentence to its cleanest components. Flag and replace:

**Dead-weight phrases → concise replacements:**

| Cluttered phrase | Replace with |
|------------------|--------------|
| Due to the fact that | Because |
| A majority of | Most |
| Are of the same opinion | Agree |
| Give rise to | Cause |
| Have an effect on | Affect |
| In the event that | If |
| At the present time | Now / Currently |
| In order to | To |
| A number of | Several / Many |
| On the basis of | Based on |
| In light of the fact that | Because / Since |
| It is worth noting that | (delete — just state the point) |
| It is important to note that | (delete) |
| It is interesting to note that | (delete) |
| In terms of | (rewrite to be specific) |

**Dead-weight introductory & AI phrases — delete:**
- "As it is well known..." → replace with a direct citation
- "It should be emphasized that..." → delete
- "It can be regarded that..." → delete
- "As it has been shown..." → replace with direct citation
- "Furthermore,", "Moreover,", "Importantly,", "Notably," → delete / restructure

---

### Pass 2: Active Voice and Verb Vitality

Identify who did what while maintaining standard scientific conventions.

**Passive → Active conversion protocol:**
1. Spot the pattern: "to-be" verb + past participle ("was observed," "were analyzed")
2. Identify the actor: Default to "We" if the authors did it.
3. Reconstruct as Subject–Verb–Object.

**Smothered verbs (Nominalizations) → Resurrect the verb:**

| Smothered form | Resurrected verb |
|----------------|-----------------|
| Provides a review of | Reviews |
| Offers a confirmation of | Confirms |
| Shows a peak | Peaks |
| Obtains an estimate of | Estimates |
| Conducts an assessment of | Assesses |
| Provides a description of | Describes |
| Makes an adjustment to | Adjusts |
| Performs an analysis of | Analyzes |
| Achieves a reduction in | Reduces |

---

### Pass 3: Sentence Architecture & Punctuation Strictness

- **NO em-dashes (`—` or `--`):** Split into separate sentences or use natural conjunctions.
- **NO unnecessary colons (`:`):** Restructure sentences to avoid colon lists.
- **NO semicolons (`;`):** Use separate sentences or simple conjunctions ("and", "but").
- **Sentence length variation:** Avoid uniform sentence lengths. Mix short declarative statements with detailed explanations.

---

### Pass 4: Keyword Consistency and Terminology

- **The Banana Rule:** Maintain strict terminology. If the Methods state "inward-facing conformation", do not arbitrarily change to "inward state" or "inside structure".
- **Acronym austerity:** Define acronyms at first usage; avoid unnecessary non-standard acronyms.

---

### Pass 5: Numerical Consistency and Citation Integrity

- Check that numbers in text match tables, figures, and raw data.
- Ensure all citation keys exist in the project `.bib` file and resolve cleanly without `?` warnings.

---

## Constraints

- **Never alter scientific content.** Improve delivery and clarity, not substance.
- **Respect author's voice.** Maintain the author's direct, quantitative tone.
- **Always run `mark_remover.sh`** on modified/generated `.tex` and `.pdf` files.
