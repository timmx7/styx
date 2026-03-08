package proxy

import (
	"net/http"
	"strings"
)

// CleanStyxHeaders removes Styx-specific headers and hop-by-hop headers
// that should not be forwarded to the upstream provider.
func CleanStyxHeaders(headers http.Header) http.Header {
	clean := make(http.Header)
	for key, values := range headers {
		lower := strings.ToLower(key)

		// Skip Styx internal headers
		if strings.HasPrefix(lower, "x-styx-") {
			continue
		}

		// Skip hop-by-hop headers
		switch lower {
		case "connection", "keep-alive", "proxy-authenticate",
			"proxy-authorization", "te", "trailers",
			"transfer-encoding", "upgrade":
			continue
		}

		// Skip the original authorization (will be replaced by provider adapter)
		if lower == "authorization" || lower == "x-api-key" {
			continue
		}

		for _, v := range values {
			clean.Add(key, v)
		}
	}

	return clean
}
