{{/*
══════════════════════════════════════════════════════════════════════
Styx Helm — Template Helpers
══════════════════════════════════════════════════════════════════════
*/}}

{{/*
Expand the chart name.
*/}}
{{- define "styx.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "styx.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label value.
*/}}
{{- define "styx.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "styx.labels" -}}
helm.sh/chart: {{ include "styx.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: styx
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels for a specific component.
Usage: {{ include "styx.selectorLabels" (dict "root" . "component" "router") }}
*/}}
{{- define "styx.selectorLabels" -}}
app.kubernetes.io/name: {{ include "styx.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Full labels for a specific component (common + selector).
Usage: {{ include "styx.componentLabels" (dict "root" . "component" "router") }}
*/}}
{{- define "styx.componentLabels" -}}
{{ include "styx.labels" .root }}
{{ include "styx.selectorLabels" (dict "root" .root "component" .component) }}
{{- end }}

{{/*
Image reference for a component.
Usage: {{ include "styx.image" (dict "root" . "image" .Values.router.image) }}
*/}}
{{- define "styx.image" -}}
{{- $registry := .root.Values.global.imageRegistry -}}
{{- $repository := .image.repository -}}
{{- $tag := .image.tag | default .root.Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Image pull secrets.
*/}}
{{- define "styx.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Name of the Secret resource containing all credentials.
*/}}
{{- define "styx.secretName" -}}
{{ include "styx.fullname" . }}-secrets
{{- end }}

{{/*
Name of the ConfigMap for the Go router configuration.
*/}}
{{- define "styx.routerConfigMapName" -}}
{{ include "styx.fullname" . }}-router-config
{{- end }}

{{/*
Name of the ConfigMap for ClickHouse init SQL.
*/}}
{{- define "styx.clickhouseInitConfigMapName" -}}
{{ include "styx.fullname" . }}-clickhouse-init
{{- end }}

{{/*
Internal service URLs — used by multiple templates.
*/}}
{{- define "styx.backendUrl" -}}
http://{{ include "styx.fullname" . }}-backend:{{ .Values.backend.service.port }}
{{- end }}

{{- define "styx.classifierUrl" -}}
http://{{ include "styx.fullname" . }}-classifier:{{ .Values.classifier.service.port }}
{{- end }}

{{- define "styx.cacheServiceUrl" -}}
http://{{ include "styx.fullname" . }}-cache-service:{{ .Values.cacheService.service.port }}
{{- end }}

{{- define "styx.redisUrl" -}}
redis://{{ include "styx.fullname" . }}-redis:{{ .Values.redis.service.port }}
{{- end }}

{{- define "styx.postgresUrl" -}}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.externalUrl -}}
{{ .Values.postgresql.externalUrl }}
{{- else -}}
postgresql+asyncpg://{{ .Values.postgresql.auth.username }}:$(POSTGRES_PASSWORD)@{{ include "styx.fullname" . }}-postgresql:{{ .Values.postgresql.service.port }}/{{ .Values.postgresql.auth.database }}
{{- end -}}
{{- end }}

{{- define "styx.qdrantUrl" -}}
http://{{ include "styx.fullname" . }}-qdrant:{{ .Values.qdrant.service.httpPort }}
{{- end }}

{{- define "styx.clickhouseUrl" -}}
http://{{ include "styx.fullname" . }}-clickhouse:{{ .Values.clickhouse.service.httpPort }}
{{- end }}

{{/*
Security context for non-root containers (uid/gid 1001).
*/}}
{{- define "styx.securityContext" -}}
runAsUser: 1001
runAsGroup: 1001
runAsNonRoot: true
allowPrivilegeEscalation: false
readOnlyRootFilesystem: false
seccompProfile:
  type: RuntimeDefault
capabilities:
  drop:
    - ALL
{{- end }}

{{/*
Pod security context.
*/}}
{{- define "styx.podSecurityContext" -}}
fsGroup: 1001
runAsNonRoot: true
{{- end }}

{{/*
Service account name (falls back to "default").
*/}}
{{- define "styx.serviceAccountName" -}}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
