# iOS Home and Chat stream recovery

## 7 November 2026 — Home send reports offline after thinking

Owner reported that sending the widget prepare request from Home showed thinking,
then “You're offline. Check your connection.” Direct Chat subsequently created
GitHub issue #1634 and Factory task 23 (created-event comment at 17:22:31 UTC).
That proves issue/task handoff, not worker execution or a completed scaffold.

Source investigation found two shared transport defects: URLSessionTransport held
small SSE frames until 16 KB or EOF, hiding the accepted message ID needed for
reattachment; chat streams inherited the ordinary 30-second timeout despite a
210-second hosted invocation budget. The screenshot cannot establish the exact
underlying URLError. Home hands off to the same Chat model and transport.

The candidate flushes bytes at CR/LF or the existing 16 KB cap and gives streams a
240-second idle budget, matching the existing ingress ceiling. Ordinary reads keep
the configured 30-second bound. Accepted turns retain the existing bounded GET
reattachment and replay suppression; initial POSTs are never retried automatically.
Timeout and interrupted-connection copy are separate and do not claim the phone is
offline. Read-only recovery never creates a second scaffold.

Native URLProtocol tests compile the production adapter into the existing test
runner and exercise real URLSession AsyncBytes with an open small stream, split
UTF-8, and timeout after acceptance followed by one GET and one final response.
The Home handoff and Chat turn tests are also selected. Local Docker execution was
blocked by daemon disk capacity; no local Swift success is claimed. CI/native
qualification and release are pending.

Apple documentation actually read: URLSession.AsyncBytes and
URLRequest.timeoutInterval (developer.apple.com documentation JSON). The latter
defines timeout as inactivity and recommends cancellation for long operations;
this keeps the existing explicit cancellation and bounded recovery.
