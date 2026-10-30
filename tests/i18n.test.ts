import { describe, expect, it } from "vitest"
import {
  DEFAULT_LOCALE,
  detectLocale,
  getCatalog,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "../.opencode/plugins/telegram-notify/i18n.js"

describe("normalizeLocale", () => {
  it("accepts supported locales in common notations", () => {
    expect(normalizeLocale("en")).toBe("en")
    expect(normalizeLocale("EN")).toBe("en")
    expect(normalizeLocale("en-US")).toBe("en")
    expect(normalizeLocale("en_US.UTF-8")).toBe("en")

    expect(normalizeLocale("ru")).toBe("ru")
    expect(normalizeLocale("ru-RU")).toBe("ru")
    expect(normalizeLocale("RU_ru.UTF-8")).toBe("ru")

    expect(normalizeLocale("es")).toBe("es")
    expect(normalizeLocale("ES")).toBe("es")
    expect(normalizeLocale("es-ES")).toBe("es")
    expect(normalizeLocale("es_ES.UTF-8")).toBe("es")
  })

  it("falls back to the default locale for unsupported or empty input", () => {
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale("")).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE)
  })
})

describe("getCatalog", () => {
  it("returns localized templates for supported locales", () => {
    expect(getCatalog("en").successTitle).toBe("OpenCode completed successfully")
    expect(getCatalog("ru").successTitle).toBe("OpenCode завершил выполнение")
    expect(getCatalog("es").successTitle).toBe("OpenCode completó la ejecución correctamente")
  })

  it("falls back to English for unsupported locales", () => {
    const catalog = getCatalog("de")
    expect(catalog.code).toBe("en")
    expect(catalog.request).toBe("Request:")
  })

  it("formats localized durations", () => {
    expect(getCatalog("en").duration(5_000)).toBe("5 s")
    expect(getCatalog("en").duration(75_000)).toBe("1 min 15 s")
    expect(getCatalog("ru").duration(5_000)).toBe("5 сек")
    expect(getCatalog("ru").duration(75_000)).toBe("1 мин 15 сек")
    expect(getCatalog("es").duration(5_000)).toBe("5 s")
    expect(getCatalog("es").duration(75_000)).toBe("1 min 15 s")
  })
})

describe("detectLocale", () => {
  it("lets TELEGRAM_LANGUAGE override the host-preferred locale", () => {
    expect(
      detectLocale({
        preferred: "en",
        env: { TELEGRAM_LANGUAGE: "ru", LANG: "de_DE.UTF-8" },
      }),
    ).toBe("ru")
  })

  it("uses the host-preferred locale when TELEGRAM_LANGUAGE is unset", () => {
    expect(
      detectLocale({
        preferred: "ru-RU",
        env: { LANG: "de_DE.UTF-8" },
      }),
    ).toBe("ru")
  })

  it("then uses TELEGRAM_LANGUAGE before LC_ALL and LANG", () => {
    expect(
      detectLocale({
        env: { TELEGRAM_LANGUAGE: "ru", LC_ALL: "de_DE.UTF-8", LANG: "en_US.UTF-8" },
        defaultLocale: "en",
      }),
    ).toBe("ru")
  })

  it("then uses LC_ALL and LANG", () => {
    expect(detectLocale({ env: { LC_ALL: "ru_RU.UTF-8", LANG: "en_US.UTF-8" }, defaultLocale: "en" })).toBe("ru")
    expect(detectLocale({ env: { LANG: "ru_RU.UTF-8" }, defaultLocale: "en" })).toBe("ru")
  })

  it("falls back to the provided default/system locale", () => {
    expect(detectLocale({ env: {}, defaultLocale: "ru-RU" })).toBe("ru")
  })

  it("normalizes unsupported values to English", () => {
    expect(detectLocale({ env: { TELEGRAM_LANGUAGE: "fr" }, defaultLocale: "ru" })).toBe("en")
  })

  it("supports exactly the locales shipped in the catalog", () => {
    expect(SUPPORTED_LOCALES.sort()).toEqual(["en", "es", "ru"])
  })
})
