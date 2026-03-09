#!/usr/bin/env python3
"""Train the classifier model and save it for the service to load."""

import pickle
from pathlib import Path

from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline


def generate_training_data():
    simple = [
        "What is the capital of France?",
        "Translate hello to Spanish",
        "What is 2 + 2?",
        "Define photosynthesis",
        "What color is the sky?",
        "Who wrote Romeo and Juliet?",
        "What is the boiling point of water?",
        "Name the planets in the solar system",
        "What is HTTP?",
        "Convert 100F to Celsius",
        "What does API stand for?",
        "How many days in a year?",
        "What is JSON?",
        "What is a variable?",
        "What programming language is Python?",
        "Hello, how are you?",
        "Say hi",
        "What time is it?",
        "Tell me a joke",
        "What is 10 * 5?",
        "Who is the president?",
        "What is DNA?",
        "Spell the word beautiful",
        "What is gravity?",
        "Name a fruit",
    ]

    medium = [
        "Write a Python function to sort a list using merge sort",
        "Explain the differences between SQL and NoSQL databases",
        "Create a REST API endpoint for user authentication",
        "Write a regex to validate email addresses",
        "Explain how Docker containers work",
        "Create a bash script to backup a database",
        "Write a TypeScript interface for a user profile",
        "Explain the SOLID principles with examples",
        "Create a React component with pagination",
        "Write unit tests for a shopping cart",
        "Explain how OAuth 2.0 works step by step",
        "Write a SQL query to find duplicates",
        "Explain threads vs processes",
        "Create a CI/CD pipeline for GitHub Actions",
        "Write rate limiting middleware in Express",
        "Summarize this article about climate change",
        "Generate a list of 10 marketing ideas",
        "Describe the benefits of microservices",
        "Write a Python decorator for caching",
        "Explain how WebSockets work",
        "Convert this CSV data to JSON format",
        "Write a function to validate credit card numbers",
        "Explain the CAP theorem",
        "Create a database schema for a blog",
        "Write error handling for an API client",
    ]

    complex_ = [
        "Analyze this legal contract and identify all potential risks and compliance issues. Provide detailed recommendations.",
        "Design a distributed system architecture for a real-time trading platform handling 1M transactions per second with fault tolerance.",
        "Review this 500-line codebase for security vulnerabilities and suggest fixes for each finding with code examples.",
        "Create a comprehensive business plan for a SaaS startup including market analysis, financial projections, and go-to-market strategy.",
        "Write a detailed technical specification for a machine learning pipeline for fraud detection including data preprocessing.",
        "Analyze this dataset and provide insights on churn prediction with statistical significance testing.",
        "Design a microservices architecture for a healthcare platform with HIPAA compliance requirements and audit logging.",
        "Write a comprehensive code review covering performance, security, and maintainability for this large pull request with refactoring suggestions.",
        "Create a detailed migration plan for moving a monolithic application to Kubernetes with zero downtime and rollback strategy.",
        "Analyze the following research paper and provide a critical review with methodology assessment and improvement suggestions.",
        "Design a recommendation engine using collaborative filtering and content-based approaches with A/B testing framework.",
        "Write a detailed incident response plan for a data breach scenario including communication templates and legal requirements.",
        "Create a full test strategy covering unit, integration, performance, security testing with CI/CD integration.",
        "Design a data warehouse architecture with real-time analytics and ETL pipelines for financial reporting.",
        "Write comprehensive API documentation with OpenAPI spec, authentication guides, rate limiting, and SDK examples.",
        "Build a complete authentication system with OAuth2, MFA, session management, and password reset flow.",
        "Architect a multi-tenant SaaS platform with data isolation, billing, and custom domain support.",
        "Create a comprehensive monitoring and observability strategy with dashboards, alerts, and runbooks.",
        "Design and implement a caching strategy across multiple layers including CDN, application cache, and database query cache.",
        "Perform a full security audit of this application including OWASP top 10 analysis and penetration testing recommendations.",
        "Write a complete DevOps automation framework including infrastructure as code, deployment pipelines, and disaster recovery.",
        "Design a real-time data processing pipeline using event sourcing and CQRS patterns for an IoT platform.",
        "Create a comprehensive compliance framework for GDPR, SOC2, and ISO 27001 with implementation roadmap.",
        "Architect a global CDN with edge computing capabilities, automatic failover, and intelligent routing.",
        "Design a complete CI/CD platform with multi-environment support, canary deployments, and automated rollbacks.",
    ]

    prompts = simple + medium + complex_
    labels = ["simple"] * len(simple) + ["medium"] * len(medium) + ["complex"] * len(complex_)
    return prompts, labels


def main():
    prompts, labels = generate_training_data()
    print(f"Training on {len(prompts)} samples...")

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(max_features=5000, ngram_range=(1, 2), stop_words="english")),
        ("clf", RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)),
    ])

    scores = cross_val_score(pipeline, prompts, labels, cv=5, scoring="accuracy")
    print(f"Cross-validation accuracy: {scores.mean():.3f} (+/- {scores.std() * 2:.3f})")

    pipeline.fit(prompts, labels)

    result = {
        "pipeline": pipeline,
        "cv_accuracy": float(scores.mean()),
        "cv_std": float(scores.std()),
        "classes": list(pipeline.classes_),
        "n_samples": len(prompts),
    }

    output = Path(__file__).parent / "model.pkl"
    with open(output, "wb") as f:
        pickle.dump(result, f)

    print(f"Model saved to {output}")
    print(f"Classes: {result['classes']}")


if __name__ == "__main__":
    main()
