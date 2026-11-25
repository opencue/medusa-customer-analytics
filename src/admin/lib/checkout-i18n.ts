import { useTranslation } from "react-i18next"

export const CHECKOUT_NAMESPACE = "checkout-analytics"

// Medusa's language selector uses these resource IDs instead of BCP 47 tags.
const REGIONAL_LOCALES: Record<string, string> = {
  enGB: "en-GB",
  ptBR: "pt-BR",
  ptPT: "pt-PT",
  zhCN: "zh-CN",
  zhTW: "zh-TW",
}

export const resolveCheckoutLocale = (language: string): string => {
  const tag = REGIONAL_LOCALES[language] ?? language
  try {
    return Intl.NumberFormat.supportedLocalesOf(tag)[0] ?? "en"
  } catch {
    // Custom Admin IDs are not necessarily valid Intl language tags.
    return "en"
  }
}

export const useCheckoutTranslation = () => {
  const { t, i18n } = useTranslation(CHECKOUT_NAMESPACE)
  const language = i18n.resolvedLanguage || i18n.language || "en"
  return { t, locale: resolveCheckoutLocale(language) }
}
