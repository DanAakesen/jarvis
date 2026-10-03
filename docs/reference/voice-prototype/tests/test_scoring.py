from scoring import CASES, is_danish, score_intent, score_status, wer


def case(case_id: str) -> dict:
    return next(c for c in CASES["commands"] + CASES["status_questions"] if c["id"] == case_id)


def test_wer_ignores_case_punctuation_and_hyphens() -> None:
    assert wer("Sæt Jarvis-opgaven på pause.", "sæt jarvis opgaven på pause") == 0
    assert wer("Hvad kører lige nu?", "hvad kører nu") == 0.25
    assert wer("Hvad er status på opgave hundrede og tre?", "Hvad er status på opgave 103?") == 0


def test_create_task_needs_project_agent_and_keyword() -> None:
    call = {"name": "create_task", "arguments": {"project": "Jarvis", "agent": "codex", "text": "Tilføj Dark Mode"}}
    assert score_intent(case("c01"), [call])[0]
    wrong = {**call, "arguments": {**call["arguments"], "agent": "copilot"}}
    assert not score_intent(case("c01"), [wrong])[0]


def test_alternatives_and_no_action() -> None:
    assert score_intent(case("c13"), [{"name": "list_tasks", "arguments": {}}])[0]
    assert score_intent(case("c20"), [{"name": "list_tasks", "arguments": {}}])[0]
    assert not score_intent(case("c20"), [{"name": "pause_task", "arguments": {"task_id": "T-101"}}])[0]


def test_status_answer_must_be_danish_with_fact() -> None:
    assert score_status(case("s02"), "Banking-opgaven er færdig, og pull request 42 er klar.")[0]
    assert not score_status(case("s02"), "The Banking task is done and PR 42 is ready.")[0]
    assert is_danish("Codex kører testene på Jarvis lige nu.")
