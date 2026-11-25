import resources from ".."
import en from "../json/en.json"
import { resolveCheckoutLocale } from "../../lib/checkout-i18n"
import { formatAgo, formatCount, formatMoney, formatPercent } from "../../routes/checkout-tracker/format"

// Medusa Admin languages in v2.23.0, plus Slovak for stores that expose it.
const languages = ["ar","bg","bs","cs","de","el","en","enGB","es","fa","fi","fr","he","hr","hu","id","it","ja","ko","lt","mk","mn","nl","pl","ptBR","ptPT","ro","ru","sk","sv","th","tr","uk","vi","zhCN","zhTW"]

type Catalog = { [key: string]: string | Catalog }

const flatten = (catalog: Catalog, prefix = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "string" ? [[prefix + key, value]] : Object.entries(flatten(value, prefix + key + "."))
  ))

const placeholders = (value: string) =>
  [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort()

test("registers a checkout catalog for every supported Admin language", () => {
  expect(Object.keys(resources).sort()).toEqual(languages)
})

test.each(languages)("%s translates every message and preserves placeholders", (language) => {
  const english = flatten(en)
  const translated = flatten(resources[language]["checkout-analytics"])
  expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort())
  for (const key of Object.keys(english)) {
    expect(translated[key].trim()).not.toBe("")
    expect([key, placeholders(translated[key])]).toEqual([key, placeholders(english[key])])
  }
})

test.each([
  ["ar", "ar"],
  ["enGB", "en-GB"],
  ["ptBR", "pt-BR"],
  ["ptPT", "pt-PT"],
  ["zhCN", "zh-CN"],
  ["zhTW", "zh-TW"],
  ["esES", "en"],
  ["en_US", "en"],
  ["zzz", "en"],
])("resolves Admin language %s to formatting locale %s", (language, locale) => {
  expect(resolveCheckoutLocale(language)).toBe(locale)
})

test("formats values and relative time in the active Admin locale", () => {
  expect(formatCount(1234, "en")).toBe("1,234")
  expect(formatCount(1234, "de")).toBe("1.234")
  expect(formatPercent(0.256, "de")).toMatch(/^25,6\s%$/u)
  expect(formatMoney(1234.50, "eur", "de")).toMatch(/^1\.234,50\s€$/u)
  expect(formatAgo("2026-01-01T00:00:00Z", Date.parse("2026-01-02T00:00:00Z"), "de")).toBe("gestern")
})
