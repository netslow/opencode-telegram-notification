import { join } from "node:path"
import { homedir } from "node:os"
import { describe, expect, it } from "vitest"
import {
  envFiles,
  loadEnv,
  loadTelegramConfig,
  parseEnvFile,
  redactToken,
  resolveGlobalConfigDir,
  resolveLogFile,
  type LoadTelegramConfigOptions,
} from "../.opencode/plugins/telegram-notify/config.js"

function fakeFs(files: Record<string, string>) {
  return {
    existsSync: (path: string) => path in files,
    readFileSync: (path: string, encoding: "utf8") => files[path],
  }
}

function baseOptions(env: Record<string, string | undefined> = {}): LoadTelegramConfigOptions {
  return { env, fs: fakeFs({}), envFiles: [] }
}

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, comments and quotes", () => {
    const parsed = parseEnvFile(`
# comment
TELEGRAM_BOT_TOKEN=123:abc
TELEGRAM_CHAT_ID="12345"
export TELEGRAM_ENABLED='true'
EMPTY=
`)
    expect(parsed).toEqual({
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_CHAT_ID: "12345",
      TELEGRAM_ENABLED: "true",
      EMPTY: "",
    })
  })
})

describe("loadEnv", () => {
  it("prefers process environment over .env files", () => {
    const env = loadEnv({
      env: { TELEGRAM_BOT_TOKEN: "from-env" },
      fs: fakeFs({ "/proj/.env": "TELEGRAM_BOT_TOKEN=from-file\nTELEGRAM_CHAT_ID=chat" }),
      directory: "/proj",
    })
    expect(env.TELEGRAM_BOT_TOKEN).toBe("from-env")
    expect(env.TELEGRAM_CHAT_ID).toBe("chat")
  })

  it("reads .env from the project directory", () => {
    const env = loadEnv({
      env: {},
      fs: fakeFs({ "/proj/.env": "TELEGRAM_BOT_TOKEN=123\nTELEGRAM_CHAT_ID=456" }),
      directory: "/proj",
    })
    expect(env.TELEGRAM_BOT_TOKEN).toBe("123")
    expect(env.TELEGRAM_CHAT_ID).toBe("456")
  })
})

describe("envFiles", () => {
  it("lists project, global and explicit env files in ascending priority", () => {
    expect(envFiles({ directory: "/p", globalDirectory: "/g", envFiles: ["/x.env"] })).toEqual([
      "/p/.env",
      "/g/.env",
      "/x.env",
    ])
  })

  it("skips the project .env when the directory is the home directory", () => {
    expect(envFiles({ directory: homedir(), globalDirectory: "/g" })).toEqual(["/g/.env"])
  })
})

describe("resolveGlobalConfigDir", () => {
  it("uses %USERPROFILE%\\.config\\opencode on Windows", () => {
    expect(resolveGlobalConfigDir({ USERPROFILE: "C:\\Users\\test" }, "win32")).toBe(
      join("C:\\Users\\test", ".config", "opencode"),
    )
  })

  it("uses XDG_CONFIG_HOME on non-Windows when set", () => {
    expect(resolveGlobalConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(join("/xdg", "opencode"))
  })

  it("falls back to $HOME/.config/opencode on non-Windows", () => {
    expect(resolveGlobalConfigDir({ HOME: "/home/test" }, "darwin")).toBe(
      join("/home/test", ".config", "opencode"),
    )
  })

  it("falls back to the OS home directory", () => {
    expect(resolveGlobalConfigDir({}, "linux")).toBe(join(homedir(), ".config", "opencode"))
  })
})

describe("resolveLogFile", () => {
  it("uses %USERPROFILE%\\.local\\share\\opencode\\log on Windows", () => {
    expect(resolveLogFile({ USERPROFILE: "C:\\Users\\test" }, "win32")).toBe(
      join("C:\\Users\\test", ".local", "share", "opencode", "log", "telegram-notify.log"),
    )
  })

  it("honors XDG_DATA_HOME on non-Windows", () => {
    expect(resolveLogFile({ XDG_DATA_HOME: "/data" }, "linux")).toBe(
      join("/data", "opencode", "log", "telegram-notify.log"),
    )
  })

  it("falls back to ~/.local/share on non-Windows", () => {
    expect(resolveLogFile({ HOME: "/home/test" }, "darwin")).toBe(
      join("/home/test", ".local", "share", "opencode", "log", "telegram-notify.log"),
    )
  })
})

describe("loadTelegramConfig", () => {
  it("is disabled when token is missing", () => {
    const config = loadTelegramConfig(baseOptions({ TELEGRAM_CHAT_ID: "123" }))
    expect(config.enabled).toBe(false)
    expect(config.botToken).toBeUndefined()
  })

  it("is disabled when chat id is missing", () => {
    const config = loadTelegramConfig(baseOptions({ TELEGRAM_BOT_TOKEN: "token" }))
    expect(config.enabled).toBe(false)
    expect(config.chatId).toBeUndefined()
  })

  it("is disabled when TELEGRAM_ENABLED=false even with credentials", () => {
    const config = loadTelegramConfig(
      baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123", TELEGRAM_ENABLED: "false" }),
    )
    expect(config.enabled).toBe(false)
  })

  it("is enabled with token and chat id", () => {
    const config = loadTelegramConfig(
      baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123" }),
    )
    expect(config.enabled).toBe(true)
    expect(config.botToken).toBe("token")
    expect(config.chatId).toBe("123")
  })

  it("loads credentials from .env", () => {
    const config = loadTelegramConfig({
      env: {},
      fs: fakeFs({ "/proj/.env": "TELEGRAM_BOT_TOKEN=from-file\nTELEGRAM_CHAT_ID=from-file-chat" }),
      directory: "/proj",
      envFiles: [],
    })
    expect(config.enabled).toBe(true)
    expect(config.botToken).toBe("from-file")
    expect(config.chatId).toBe("from-file-chat")
  })

  it("loads credentials from the global .env", () => {
    const config = loadTelegramConfig({
      env: {},
      fs: fakeFs({
        "/home/u/.config/opencode/.env": "TELEGRAM_BOT_TOKEN=from-global\nTELEGRAM_CHAT_ID=42",
      }),
      globalDirectory: "/home/u/.config/opencode",
      envFiles: [],
    })
    expect(config.enabled).toBe(true)
    expect(config.botToken).toBe("from-global")
    expect(config.logFile).toBe(resolveLogFile({}))
  })

  it("always uses the default log path, ignoring TELEGRAM_LOG_FILE", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "1",
      TELEGRAM_LOG_FILE: "C:\\dev\\telegram-notify.log",
    }
    const config = loadTelegramConfig(baseOptions(env))
    expect(config.logFile).toBe(resolveLogFile(env))
    expect(config.logFile).not.toContain("C:\\dev")
  })

  it("defaults logFile when TELEGRAM_LOG_FILE is not set", () => {
    const env = { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "1" }
    const config = loadTelegramConfig(baseOptions(env))
    expect(config.logFile).toBe(resolveLogFile(env))
  })

  it("applies timeout and retries from env", () => {
    const config = loadTelegramConfig(
      baseOptions({
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_CHAT_ID: "123",
        TELEGRAM_TIMEOUT_SECONDS: "25",
        TELEGRAM_RETRIES: "4",
      }),
    )
    expect(config.timeoutMs).toBe(25_000)
    expect(config.retries).toBe(4)
  })

  it("reads proxy variables from the environment", () => {
    const config = loadTelegramConfig(
      baseOptions({
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_CHAT_ID: "123",
        HTTP_PROXY: "http://http-proxy:8080",
        HTTPS_PROXY: "http://https-proxy:8080",
        NO_PROXY: "localhost,127.0.0.1",
      }),
    )
    expect(config.proxy).toEqual({
      httpProxy: "http://http-proxy:8080",
      httpsProxy: "http://https-proxy:8080",
      noProxy: "localhost,127.0.0.1",
    })
  })

  it("honors lowercase proxy variable variants", () => {
    const config = loadTelegramConfig(
      baseOptions({
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_CHAT_ID: "123",
        https_proxy: "http://lowercase-proxy:3128",
      }),
    )
    expect(config.proxy?.httpsProxy).toBe("http://lowercase-proxy:3128")
    expect(config.proxy?.httpProxy).toBeUndefined()
  })

  it("reads proxy variables from .env", () => {
    const config = loadTelegramConfig({
      env: {},
      fs: fakeFs({
        "/proj/.env":
          "TELEGRAM_BOT_TOKEN=from-file\nTELEGRAM_CHAT_ID=from-file-chat\nHTTPS_PROXY=http://env-proxy:3128",
      }),
      directory: "/proj",
      envFiles: [],
    })
    expect(config.proxy?.httpsProxy).toBe("http://env-proxy:3128")
    expect(config.proxy?.httpProxy).toBeUndefined()
  })

  it("leaves proxy undefined when not configured", () => {
    const config = loadTelegramConfig(baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123" }))
    expect(config.proxy).toEqual({ httpProxy: undefined, httpsProxy: undefined, noProxy: undefined })
  })

  it("resolves the locale from TELEGRAM_LANGUAGE", () => {
    const config = loadTelegramConfig(
      baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123", TELEGRAM_LANGUAGE: "ru" }),
    )
    expect(config.locale).toBe("ru")
  })

  it("falls back to English for an unsupported TELEGRAM_LANGUAGE", () => {
    const config = loadTelegramConfig(
      baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123", TELEGRAM_LANGUAGE: "fr" }),
    )
    expect(config.locale).toBe("en")
  })

  it("reads TELEGRAM_LANGUAGE from a .env file", () => {
    const config = loadTelegramConfig({
      env: {},
      fs: fakeFs({
        "/proj/.env": "TELEGRAM_BOT_TOKEN=token\nTELEGRAM_CHAT_ID=123\nTELEGRAM_LANGUAGE=ru",
      }),
      directory: "/proj",
      envFiles: [],
      language: "en",
    })
    expect(config.locale).toBe("ru")
  })

  it("lets TELEGRAM_LANGUAGE override the host-provided language", () => {
    const config = loadTelegramConfig({
      ...baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123", TELEGRAM_LANGUAGE: "ru" }),
      language: "en",
    })
    expect(config.locale).toBe("ru")
  })

  it("falls back to the host-provided language when TELEGRAM_LANGUAGE is unset", () => {
    const config = loadTelegramConfig({
      ...baseOptions({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123" }),
      language: "ru",
    })
    expect(config.locale).toBe("ru")
  })
})

describe("redactToken", () => {
  it("redacts the token from error messages", () => {
    const config = loadTelegramConfig(baseOptions({ TELEGRAM_BOT_TOKEN: "SECRETTOKEN", TELEGRAM_CHAT_ID: "1" }))
    expect(redactToken("failed to fetch https://api.telegram.org/botSECRETTOKEN/sendMessage", config)).toBe(
      "failed to fetch https://api.telegram.org/bot***/sendMessage",
    )
    expect(redactToken("no token", config)).toBe("no token")
  })
})
