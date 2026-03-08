/** i18n translation system — lightweight, no external dependencies.
 *
 * Usage:
 *   import { useTranslation } from "@/lib/i18n/context";
 *   const { t } = useTranslation();
 *   <h1>{t("dashboard.title")}</h1>
 */

export type Locale = "en" | "fr" | "es" | "de";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Fran\u00e7ais",
  es: "Espa\u00f1ol",
  de: "Deutsch",
};

type TranslationKeys = {
  // Navigation
  "nav.overview": string;
  "nav.analytics": string;
  "nav.projects": string;
  "nav.keys": string;
  "nav.routing": string;
  "nav.billing": string;
  "nav.alerts": string;
  "nav.logs": string;
  "nav.settings": string;

  // Dashboard
  "dashboard.title": string;
  "dashboard.subtitle": string;
  "dashboard.totalRequests": string;
  "dashboard.totalCost": string;
  "dashboard.cacheHitRate": string;
  "dashboard.avgLatency": string;

  // Common
  "common.loading": string;
  "common.error": string;
  "common.save": string;
  "common.cancel": string;
  "common.delete": string;
  "common.create": string;
  "common.edit": string;
  "common.search": string;
  "common.noResults": string;
  "common.confirm": string;
};

const en: TranslationKeys = {
  "nav.overview": "Overview",
  "nav.analytics": "Analytics",
  "nav.projects": "Projects",
  "nav.keys": "API Keys",
  "nav.routing": "Routing",
  "nav.billing": "Billing",
  "nav.alerts": "Alerts",
  "nav.logs": "Logs",
  "nav.settings": "Settings",

  "dashboard.title": "Dashboard",
  "dashboard.subtitle": "Monitor your AI gateway in real time",
  "dashboard.totalRequests": "Total Requests",
  "dashboard.totalCost": "Total Cost",
  "dashboard.cacheHitRate": "Cache Hit Rate",
  "dashboard.avgLatency": "Avg Latency",

  "common.loading": "Loading...",
  "common.error": "An error occurred",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.create": "Create",
  "common.edit": "Edit",
  "common.search": "Search...",
  "common.noResults": "No results found",
  "common.confirm": "Confirm",
};

const fr: TranslationKeys = {
  "nav.overview": "Vue d'ensemble",
  "nav.analytics": "Analytiques",
  "nav.projects": "Projets",
  "nav.keys": "Cl\u00e9s API",
  "nav.routing": "Routage",
  "nav.billing": "Facturation",
  "nav.alerts": "Alertes",
  "nav.logs": "Journaux",
  "nav.settings": "Param\u00e8tres",

  "dashboard.title": "Tableau de bord",
  "dashboard.subtitle": "Surveillez votre passerelle IA en temps r\u00e9el",
  "dashboard.totalRequests": "Total requ\u00eates",
  "dashboard.totalCost": "Co\u00fbt total",
  "dashboard.cacheHitRate": "Taux de cache",
  "dashboard.avgLatency": "Latence moy.",

  "common.loading": "Chargement...",
  "common.error": "Une erreur est survenue",
  "common.save": "Enregistrer",
  "common.cancel": "Annuler",
  "common.delete": "Supprimer",
  "common.create": "Cr\u00e9er",
  "common.edit": "Modifier",
  "common.search": "Rechercher...",
  "common.noResults": "Aucun r\u00e9sultat trouv\u00e9",
  "common.confirm": "Confirmer",
};

const es: TranslationKeys = {
  "nav.overview": "Resumen",
  "nav.analytics": "Anal\u00edticas",
  "nav.projects": "Proyectos",
  "nav.keys": "Claves API",
  "nav.routing": "Enrutamiento",
  "nav.billing": "Facturaci\u00f3n",
  "nav.alerts": "Alertas",
  "nav.logs": "Registros",
  "nav.settings": "Configuraci\u00f3n",

  "dashboard.title": "Panel",
  "dashboard.subtitle": "Monitorea tu gateway de IA en tiempo real",
  "dashboard.totalRequests": "Total solicitudes",
  "dashboard.totalCost": "Costo total",
  "dashboard.cacheHitRate": "Tasa de cach\u00e9",
  "dashboard.avgLatency": "Latencia prom.",

  "common.loading": "Cargando...",
  "common.error": "Ocurri\u00f3 un error",
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.delete": "Eliminar",
  "common.create": "Crear",
  "common.edit": "Editar",
  "common.search": "Buscar...",
  "common.noResults": "Sin resultados",
  "common.confirm": "Confirmar",
};

const de: TranslationKeys = {
  "nav.overview": "\u00dcbersicht",
  "nav.analytics": "Analysen",
  "nav.projects": "Projekte",
  "nav.keys": "API-Schl\u00fcssel",
  "nav.routing": "Routing",
  "nav.billing": "Abrechnung",
  "nav.alerts": "Warnungen",
  "nav.logs": "Protokolle",
  "nav.settings": "Einstellungen",

  "dashboard.title": "Dashboard",
  "dashboard.subtitle": "\u00dcberwachen Sie Ihr KI-Gateway in Echtzeit",
  "dashboard.totalRequests": "Anfragen gesamt",
  "dashboard.totalCost": "Gesamtkosten",
  "dashboard.cacheHitRate": "Cache-Trefferquote",
  "dashboard.avgLatency": "Durchschn. Latenz",

  "common.loading": "Laden...",
  "common.error": "Ein Fehler ist aufgetreten",
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.delete": "L\u00f6schen",
  "common.create": "Erstellen",
  "common.edit": "Bearbeiten",
  "common.search": "Suchen...",
  "common.noResults": "Keine Ergebnisse",
  "common.confirm": "Best\u00e4tigen",
};

export const translations: Record<Locale, TranslationKeys> = { en, fr, es, de };

export type TranslationKey = keyof TranslationKeys;
