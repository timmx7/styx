"""Tests that validate the SDK package structure is correct for PyPI."""

from __future__ import annotations

import importlib
import pathlib


SDK_ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestPackageStructure:
    """Verify files required for PyPI publishing exist."""

    def test_pyproject_toml_exists(self):
        assert (SDK_ROOT / "pyproject.toml").is_file()

    def test_license_exists(self):
        assert (SDK_ROOT / "LICENSE").is_file()

    def test_changelog_exists(self):
        assert (SDK_ROOT / "CHANGELOG.md").is_file()

    def test_py_typed_marker_exists(self):
        assert (SDK_ROOT / "styx" / "py.typed").is_file()

    def test_init_exists(self):
        assert (SDK_ROOT / "styx" / "__init__.py").is_file()


class TestImports:
    """Verify all public exports are importable."""

    def test_import_styx(self):
        mod = importlib.import_module("styx")
        assert hasattr(mod, "__version__")
        assert hasattr(mod, "__all__")

    def test_import_clients(self):
        from styx import Styx, AsyncStyx
        assert Styx is not None
        assert AsyncStyx is not None

    def test_import_exceptions(self):
        from styx import (
            StyxError,
            AuthenticationError,
            BadRequestError,
            BudgetExceededError,
            ConnectionError,
            InternalServerError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
            StreamError,
            TimeoutError,
        )
        # All exceptions should be subclasses of StyxError
        for exc in [
            AuthenticationError,
            BadRequestError,
            BudgetExceededError,
            InternalServerError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
            StreamError,
        ]:
            assert issubclass(exc, StyxError)

    def test_import_types(self):
        from styx import (
            StyxMetadata,
            ChatCompletion,
            ChatCompletionChunk,
            ChatMessage,
            Choice,
            DeltaMessage,
            Embedding,
            EmbeddingResponse,
            Model,
            ModelList,
            StreamChoice,
            ToolCall,
            Usage,
        )
        # Spot-check a few
        assert ChatCompletion is not None
        assert StyxMetadata is not None

    def test_import_streaming(self):
        from styx import SSEStream, AsyncSSEStream
        assert SSEStream is not None
        assert AsyncSSEStream is not None

    def test_version_matches_client(self):
        from styx import __version__
        from styx.client import _SDK_VERSION
        assert __version__ == _SDK_VERSION

    def test_all_exports_are_importable(self):
        """Every name in __all__ must actually exist in the module."""
        import styx
        for name in styx.__all__:
            assert hasattr(styx, name), f"{name} listed in __all__ but not importable"
