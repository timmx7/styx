#!/usr/bin/env python3
"""Evaluate the trained complexity classifier.

Usage:
    python -m ml.evaluate [--model MODEL_FILE] [--data DATA_FILE]

If no data file is provided, uses a held-out portion of synthetic data.
"""

import argparse
import json
import logging
import pickle
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def evaluate_model(model_path: str, test_data: str | None = None) -> dict:
    """Evaluate the classifier and print metrics."""
    try:
        from sklearn.metrics import classification_report, confusion_matrix
    except ImportError:
        logger.error("scikit-learn is required: pip install scikit-learn")
        sys.exit(1)

    # Load model
    with open(model_path, "rb") as f:
        result = pickle.load(f)

    pipeline = result["pipeline"]
    logger.info(f"Model loaded from {model_path}")
    logger.info(f"Training accuracy: {result['cv_accuracy']:.3f}")
    logger.info(f"Classes: {result['classes']}")

    # Load or generate test data
    if test_data and Path(test_data).exists():
        prompts, labels = [], []
        with open(test_data) as f:
            for line in f:
                obj = json.loads(line)
                prompts.append(obj["prompt"])
                labels.append(obj["complexity"])
    else:
        logger.info("Using built-in test prompts")
        prompts = [
            "What is Python?",
            "Write a web scraper in Python with error handling and pagination",
            "Design a complete microservices architecture for a banking application with security audit",
            "How tall is the Eiffel Tower?",
            "Create a React component with form validation",
            "Analyze this entire codebase and provide a comprehensive security review with remediation steps",
            "What is the speed of light?",
            "Write a SQL query with joins and subqueries",
            "Design a distributed consensus algorithm for a blockchain network",
        ]
        labels = [
            "simple", "medium", "complex",
            "simple", "medium", "complex",
            "simple", "medium", "complex",
        ]

    # Predict
    predictions = pipeline.predict(prompts)

    # Report
    report = classification_report(labels, predictions, output_dict=True)
    cm = confusion_matrix(labels, predictions, labels=result["classes"])

    logger.info("\n" + classification_report(labels, predictions))
    logger.info(f"Confusion matrix:\n{cm}")

    # Show individual predictions
    logger.info("\nPredictions:")
    for prompt, true, pred in zip(prompts, labels, predictions):
        status = "✓" if true == pred else "✗"
        logger.info(f"  {status} [{true:>7s}] → [{pred:>7s}] {prompt[:60]}...")

    return {
        "accuracy": report["accuracy"],
        "per_class": {
            cls: {
                "precision": report[cls]["precision"],
                "recall": report[cls]["recall"],
                "f1": report[cls]["f1-score"],
            }
            for cls in result["classes"]
            if cls in report
        },
        "confusion_matrix": cm.tolist(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate the complexity classifier")
    parser.add_argument("--model", type=str, default="ml/model.pkl", help="Model file path")
    parser.add_argument("--data", type=str, help="Test data file (JSON lines)")
    args = parser.parse_args()

    if not Path(args.model).exists():
        logger.error(f"Model not found at {args.model}. Run train_classifier.py first.")
        sys.exit(1)

    results = evaluate_model(args.model, args.data)
    logger.info(f"\nOverall accuracy: {results['accuracy']:.3f}")


if __name__ == "__main__":
    main()
