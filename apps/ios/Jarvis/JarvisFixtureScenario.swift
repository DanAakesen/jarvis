import Foundation
import JarvisCore

enum JarvisFixtureScenario {
    static func makeClient() throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!
            ),
            transport: FixtureTransport(scenario: Data(scenario.utf8)),
            tokenStore: FixtureTokenStore(),
            accessTokenProvider: FixtureTokenProvider()
        )
    }

    static func makeSettingsClient() throws -> JarvisSettingsClient {
        let client = try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!
            ),
            transport: FixtureTransport(scenario: Data(settingsScenario.utf8)),
            tokenStore: FixtureTokenStore(),
            accessTokenProvider: FixtureTokenProvider()
        )
        return JarvisSettingsClient(client: client)
    }

    private static let settingsScenario = #"""
    {
      "version": 1,
      "interactions": [{
        "method": "GET",
        "path": "/api/settings",
        "response": {
          "statusCode": 200,
          "body": {
            "settings": {
              "appearance": {"theme": "system"},
              "personality": {"tone": "british_butler", "responseStyle": "balanced", "customInstructions": ""},
              "identity": {"description": "Synthetic assistant identity"},
              "presentation": {"showWork": true},
              "voice": {
                "defaultLanguage": "da",
                "speechToTextModel": "mai-transcribe",
                "englishModel": "gpt-realtime-2.1",
                "englishVoice": "en-GB-Ryan:DragonHDLatestNeural",
                "danishVoice": "da-DK-JeppeNeural"
              },
              "research": {"depth": "standard", "maxSources": 5},
              "jarvis": {"model": "fixture-model", "reasoning": "medium"},
              "decisions": {"provider": "jev"},
              "roles": {
                "chat": {"model": "fixture-model", "reasoningEffort": "medium"},
                "vision": {"model": "fixture-vision", "reasoningEffort": "none"},
                "research": {"model": "fixture-research", "reasoningEffort": "medium"},
                "voice": {"model": "fixture-voice", "reasoningEffort": "none"},
                "transcription": {"model": "fixture-transcription", "reasoningEffort": "none"},
                "embedding": {"model": "fixture-embedding", "reasoningEffort": "none"},
                "codex": {"model": "fixture-codex", "reasoningEffort": "medium"},
                "copilot": {"model": "fixture-copilot", "reasoningEffort": "none"}
              },
              "codex": {"model": "fixture-codex", "reasoning": "medium"},
              "copilot": {"model": "fixture-copilot"},
              "global": {
                "maxParallelTasks": 2, "maxCheckAttempts": 2, "screenShareDailyFrameCap": 10,
                "visionDailyBudgetUsd": 1, "conversationSummaryDailyLimit": 10
              },
              "newProjects": {
                "owner": "fixture-owner", "visibility": "private",
                "templatesRepository": "fixture/templates", "defaultAgent": "codex",
                "policy": "deliver_pr", "maxParallelTasks": 2, "defaultBranch": "main"
              }
            },
            "options": {
              "themes": ["light", "dark", "system"],
              "personalityTones": ["british_butler", "warm", "direct", "playful"],
              "personalityResponseStyles": ["concise", "balanced", "detailed"],
              "languages": ["da", "en"],
              "speechToTextModels": ["mai-transcribe"],
              "englishModels": ["gpt-realtime-2.1"],
              "englishVoices": ["en-GB-Ryan:DragonHDLatestNeural"],
              "danishVoices": ["da-DK-JeppeNeural"],
              "researchDepths": ["quick", "standard", "deep"],
              "jarvisModels": ["fixture-model"],
              "reasoningEfforts": ["none", "low", "medium", "high"],
              "decisionProviders": ["jev", "microsoft"],
              "roles": {
                "chat": {"models": ["fixture-model"], "reasoningEffortsByModel": {"fixture-model": ["none", "medium"]}},
                "vision": {"models": ["fixture-vision"], "reasoningEffortsByModel": {"fixture-vision": ["none"]}},
                "research": {"models": ["fixture-research"], "reasoningEffortsByModel": {"fixture-research": ["medium"]}},
                "voice": {"models": ["fixture-voice"], "reasoningEffortsByModel": {"fixture-voice": ["none"]}},
                "transcription": {"models": ["fixture-transcription"], "reasoningEffortsByModel": {"fixture-transcription": ["none"]}},
                "embedding": {"models": ["fixture-embedding"], "reasoningEffortsByModel": {"fixture-embedding": ["none"]}},
                "codex": {"models": ["fixture-codex"], "reasoningEffortsByModel": {"fixture-codex": ["medium"]}},
                "copilot": {"models": ["fixture-copilot"], "reasoningEffortsByModel": {"fixture-copilot": ["none"]}}
              },
              "codexModels": ["fixture-codex"],
              "codexReasoningEfforts": ["medium"],
              "copilotModels": ["fixture-copilot"],
              "projectVisibilities": ["private", "public"],
              "projectAgents": ["codex", "copilot"],
              "projectPolicies": ["deliver_pr", "complete_without_deployment"]
            },
            "credentials": [
              {"name": "codex-login", "status": "ok", "expiresAt": null, "lastRenewedAt": null}
            ]
          }
        }
      }]
    }
    """#

    private static let scenario = #"""
    {
      "version": 1,
      "interactions": [
        {
          "method":"GET","path":"/api/conversation/history","query":{"limit":"50"},
          "response":{"statusCode":200,"body":{
            "messages":[
              {"id":"410","sessionId":"12","channel":"chat","language":"en","role":"dan","text":"Can you review the latest release?","model":null,"interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:32:00Z","toolCalls":[],"attachments":[]},
              {"id":"411","sessionId":"12","channel":"chat","language":"en","role":"jarvis","text":"I checked the candidate and the available checks passed.","model":"fixture","interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:32:40Z","toolCalls":[{"id":"fixture-tool-1","tool":"list_release","outcome":"ok","taskId":null,"artifactId":null}],"attachments":[]},
              {"id":"412","sessionId":"12","channel":"chat","language":"en","role":"dan","text":"Do I have anything important in my calendar the next 30 days?","model":null,"interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:34:00Z","toolCalls":[],"attachments":[]},
              {"id":"413","sessionId":"12","channel":"chat","language":"en","role":"jarvis","text":"## Calendar for the next 30 days\n\nYou have **3 important events**:\n\n- **Monday, 2 November · 09:00–09:30** — Product review\n- **Wednesday, 11 November · 14:00–15:00** — Dentist appointment\n- **Friday, 20 November · 10:00–11:00** — Quarterly planning","model":"fixture","interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:34:20Z","toolCalls":[{"id":"fixture-calendar-tool","tool":"get_calendar_events","outcome":"ok","taskId":null,"artifactId":null}],"attachments":[]}
            ],
            "nextCursor":null
          }}
        },
        {
          "method":"GET","path":"/api/now",
          "response":{"statusCode":200,"body":{
            "running":[{"id":"21","title":"Synthetic release task","project":"fixture","agent":"copilot","activity":"Checking the release","startedAt":"2026-10-30T09:30:00Z"}],
            "items":[
              {"id":"22","category":"attention","title":"Synthetic task needs attention","link":"task:21","at":"2026-10-30T09:30:00Z"},
              {"id":"23","category":"release","title":"Synthetic deployment update","link":"release:23","at":"2026-10-30T09:31:00Z"},
              {"id":"24","category":"credential","title":"Synthetic credential warning","link":null,"at":"2026-10-30T09:32:00Z"},
              {"id":"25","category":"alert","title":"Synthetic alert","link":null,"at":"2026-10-30T09:33:00Z"}
            ],
            "updatedAt":"2026-10-30T09:34:00Z",
            "awayMode":false,
            "confirmations":[{"id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","actionKind":"other","summary":"Synthetic confirmation awaiting a decision.","expiresAt":"2026-10-30T09:39:00Z"}]
          }}
        },
        {
          "method":"GET","path":"/api/conversation/turns/active",
          "response":{"statusCode":200,"body":{"turns":[]}}
        },
        {
          "method":"POST","path":"/api/conversation/sessions/12/turns",
          "stream":{"statusCode":200,"headers":{"Content-Type":"text/event-stream"},"chunks":[
            {"text":"event: user\ndata: {\"id\":\"430\",\"sessionId\":\"12\",\"role\":\"dan\",\"text\":\"The fixture turn\",\"model\":null,\"at\":\"2026-10-30T09:35:00Z\"}\n\n"},
            {"text":"event: delta\ndata: {\"text\":\"This response is \"}\n\n","delayMilliseconds":30},
            {"text":"event: delta\ndata: {\"text\":\"synthetic.\"}\n\n","delayMilliseconds":30},
            {"text":"event: done\ndata: {\"id\":\"431\",\"sessionId\":\"12\",\"role\":\"jarvis\",\"text\":\"This response is synthetic.\",\"model\":\"fixture\",\"at\":\"2026-10-30T09:35:01Z\"}\n\n"}
          ]}
        },
        {
          "method":"GET","path":"/api/conversation/history","query":{"limit":"50","sessionId":"12"},
          "response":{"statusCode":200,"body":{"messages":[
            {"id":"430","sessionId":"12","channel":"chat","language":"en","role":"dan","text":"The fixture turn","model":null,"interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:35:00Z","toolCalls":[],"attachments":[]},
            {"id":"431","sessionId":"12","channel":"chat","language":"en","role":"jarvis","text":"This response is synthetic.","model":"fixture","interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:35:01Z","toolCalls":[],"attachments":[]}
          ],"nextCursor":null}}
        }
      ]
    }
    """#
}

private actor FixtureTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct FixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
