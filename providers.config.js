// Code-level defaults. Layering (later wins):
//   1. this file
//   2. ~/.config/excalidraw-claude/providers.json  (written by the Settings panel; holds UI-entered keys)
//   3. .env  (apiKeyEnv names below, e.g. ANTHROPIC_API_KEY) is used when no key was saved in the UI
//
// Provider types:
//   "anthropic"      Anthropic Messages API
//   "openai-compat"  anything speaking /chat/completions: OpenAI, OpenRouter, Groq, Together, DeepSeek,
//                    Mistral, Gemini (compat endpoint), Ollama, LM Studio, vLLM, llama.cpp ...
//   "cli"            a command run per request. Only definable here or by hand-editing the config file
//                    (never from the UI: a command typed into a web page would be remote code execution).
//                    Args may use {{system}} and {{user}}; if {{user}} is absent the user prompt goes to stdin.
export default {
  providers: [
    {
      id: "claude-cli",
      name: "Claude Code CLI",
      type: "cli",
      command: "claude",
      args: ["-p", "--output-format", "text", "--tools", "", "--system-prompt", "{{system}}", "--no-session-persistence", "--disable-slash-commands"],
      modelFlag: "--model",
      effortFlag: "--effort",
      models: ["fable", "opus", "sonnet", "haiku"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultModel: "",
    },
    {
      id: "anthropic",
      name: "Anthropic API",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      defaultModel: "claude-sonnet-5-5",
    },
    {
      id: "openai",
      name: "OpenAI",
      type: "openai-compat",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "",
    },
    {
      id: "ollama",
      name: "Ollama (local)",
      type: "openai-compat",
      baseUrl: "http://localhost:11434/v1",
      defaultModel: "qwen2.5:7b",
    },
  ],

  // offered by "Add provider" in the Settings panel
  presets: [
    { name: "OpenRouter", type: "openai-compat", baseUrl: "https://openrouter.ai/api/v1" },
    { name: "Groq", type: "openai-compat", baseUrl: "https://api.groq.com/openai/v1" },
    { name: "Together", type: "openai-compat", baseUrl: "https://api.together.xyz/v1" },
    { name: "DeepSeek", type: "openai-compat", baseUrl: "https://api.deepseek.com/v1" },
    { name: "Mistral", type: "openai-compat", baseUrl: "https://api.mistral.ai/v1" },
    { name: "Gemini (OpenAI compat)", type: "openai-compat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { name: "LM Studio (local)", type: "openai-compat", baseUrl: "http://localhost:1234/v1" },
    { name: "Custom OpenAI-compatible", type: "openai-compat", baseUrl: "" },
    { name: "Custom Anthropic-compatible", type: "anthropic", baseUrl: "" },
  ],
};
