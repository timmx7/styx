#!/usr/bin/env python3
"""Train the request complexity classifier.

This script trains a simple ML model to classify API request prompts into
complexity categories: 'simple', 'medium', 'complex'.

Usage:
    python -m ml.train_classifier [--data DATA_FILE] [--output MODEL_FILE]

The classifier uses TF-IDF features with a RandomForest model. In production,
this supplements the heuristic classifier in the classifier service.
"""

import argparse
import json
import logging
import pickle
import sys
from pathlib import Path


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def generate_synthetic_data() -> tuple[list[str], list[str]]:
    """Generate synthetic training data for the classifier.

    In production, this should be replaced with real labeled data
    from the routing logs.
    """
    simple_prompts = [
        "What is the capital of France?",
        "Translate 'hello' to Spanish",
        "What is 2 + 2?",
        "Define photosynthesis",
        "What color is the sky?",
        "Who wrote Romeo and Juliet?",
        "What is the boiling point of water?",
        "Name the planets in the solar system",
        "What is HTTP?",
        "Convert 100 Fahrenheit to Celsius",
        "What does API stand for?",
        "How many days in a year?",
        "What is JSON?",
        "Summarize this sentence: The cat sat on the mat.",
        "What programming language is used for web development?",
    ]

    medium_prompts = [
        "Write a Python function to sort a list using merge sort",
        "Explain the differences between SQL and NoSQL databases",
        "Create a REST API endpoint for user authentication",
        "Write a regular expression to validate email addresses",
        "Explain how Docker containers work",
        "Create a bash script to backup a MySQL database",
        "Write a TypeScript interface for a user profile",
        "Explain the SOLID principles with examples",
        "Create a React component for a data table with pagination",
        "Write unit tests for a shopping cart class",
        "Explain how OAuth 2.0 works step by step",
        "Write a SQL query to find duplicate records",
        "Explain the difference between threads and processes",
        "Create a CI/CD pipeline configuration for GitHub Actions",
        "Write a middleware for rate limiting in Express.js",
    ]

    complex_prompts = [
        "Analyze this legal contract and identify all potential risks, liabilities, and compliance issues. Provide recommendations.",
        "Design a distributed system architecture for a real-time trading platform that handles 1M transactions per second.",
        "Review this 500-line codebase for security vulnerabilities and suggest fixes for each finding.",
        "Create a comprehensive business plan for a SaaS startup including market analysis, financial projections, and go-to-market strategy.",
        "Write a detailed technical specification for implementing a machine learning pipeline for fraud detection.",
        "Analyze this dataset of 10000 customer interactions and provide insights on churn prediction.",
        "Design a microservices architecture for a healthcare platform with HIPAA compliance requirements.",
        "Write a comprehensive code review covering performance, security, and maintainability for this large pull request.",
        "Create a detailed migration plan for moving a monolithic application to Kubernetes with zero downtime.",
        "Analyze the following research paper and provide a critical review with suggestions for improvement.",
        "Design a recommendation engine using collaborative filtering and content-based approaches for an e-commerce platform.",
        "Write a detailed incident response plan for a data breach scenario including communication templates.",
        "Create a full test strategy document covering unit, integration, performance, and security testing.",
        "Design a data warehouse architecture with real-time analytics capability for a financial services company.",
        "Write a comprehensive API documentation with examples, error handling guides, and rate limiting explanations.",
    ]

    prompts = simple_prompts + medium_prompts + complex_prompts
    labels = (
        ["simple"] * len(simple_prompts)
        + ["medium"] * len(medium_prompts)
        + ["complex"] * len(complex_prompts)
    )

    return prompts, labels


def train_model(prompts: list[str], labels: list[str]) -> dict:
    """Train a TF-IDF + RandomForest classifier."""
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.model_selection import cross_val_score
        from sklearn.pipeline import Pipeline
    except ImportError:
        logger.error("scikit-learn is required: pip install scikit-learn")
        sys.exit(1)

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            max_features=5000,
            ngram_range=(1, 2),
            stop_words="english",
        )),
        ("clf", RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1,
        )),
    ])

    # Cross-validation
    scores = cross_val_score(pipeline, prompts, labels, cv=5, scoring="accuracy")
    logger.info(f"Cross-validation accuracy: {scores.mean():.3f} (+/- {scores.std() * 2:.3f})")

    # Train on full dataset
    pipeline.fit(prompts, labels)

    return {
        "pipeline": pipeline,
        "cv_accuracy": float(scores.mean()),
        "cv_std": float(scores.std()),
        "classes": list(pipeline.classes_),
        "n_samples": len(prompts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the complexity classifier")
    parser.add_argument("--data", type=str, help="Path to labeled data (JSON lines)")
    parser.add_argument("--output", type=str, default="ml/model.pkl", help="Output model file")
    args = parser.parse_args()

    # Load data
    if args.data and Path(args.data).exists():
        logger.info(f"Loading data from {args.data}")
        prompts, labels = [], []
        with open(args.data) as f:
            for line in f:
                obj = json.loads(line)
                prompts.append(obj["prompt"])
                labels.append(obj["complexity"])
    else:
        logger.info("Using synthetic training data (no --data file provided)")
        prompts, labels = generate_synthetic_data()

    logger.info(f"Training on {len(prompts)} samples")

    # Train
    result = train_model(prompts, labels)

    # Save
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "wb") as f:
        pickle.dump(result, f)

    logger.info(f"Model saved to {output_path}")
    logger.info(f"Classes: {result['classes']}")
    logger.info(f"Accuracy: {result['cv_accuracy']:.3f}")


if __name__ == "__main__":
    main()
