/** If a tool may have run, Dan has to look before he asks again; the clean variants say nothing ran. */
const mayBeDone = 'and part of it may already be done, so check before trying again';
/** The words only the web client says (Chat only): the same advice, in its own two sentences. */
const checkFirst = 'If you asked me to do something, it may already have happened, so check before you try again.';
/** Chat and Voice say a failure in the same words, so it reads and sounds alike. */
const said = (text) => Object.freeze({ chat: text, voice: text });

/**
 * What Dan reads in Chat and hears in Voice when a turn does not finish: one plain first-person sentence that says what happened and
 * what he can do. Never an internal name (PI, Foundry, gateway, harness, MCP, approval) and never a status code. The technical code
 * and detail stay on the error for the log. The same sentence is shown and spoken (`chat` and `voice` name the channel at the call
 * site; `failure-copy.test.js` fails if they ever differ). The backend sends these words; the web recognises exactly these words.
 */
export const failureCopy = Object.freeze({
  not_set_up: said("I can't answer yet because my setup isn't finished, so nothing was sent."),
  allowance_used: said("I've used this month's allowance, so I can't answer until it resets or the limit is raised."),
  sign_in_failed: said("I couldn't sign in to the AI service, so nothing was sent."),
  agent_missing: said("I couldn't find my conversation in the AI service, so nothing was sent; please try again."),
  service_busy: said('The AI service is busy, so please try again in a moment.'),
  service_problem: said('The AI service had a problem, so please try again in a moment.'),
  unreachable: said("I couldn't reach the AI service, so please try again in a moment."),
  no_answer_in_time: said("The AI service didn't answer in time, so please try again."),
  no_conversation: said("I couldn't start a conversation with the AI service, so please try again."),
  no_reply_stream: said('The AI service sent nothing back, so please try again.'),
  cut_off: said(`I couldn't finish that, ${mayBeDone}.`),
  cut_off_clean: said("I couldn't finish that, but nothing was done, so please try again."),
  took_too_long: said(`That took too long, so I stopped, ${mayBeDone}.`),
  took_too_long_clean: said('That took too long and I stopped, but nothing was done, so please try again.'),
  still_answering: said("I'm still answering your last message, so please wait a moment."),
  cannot_see_frame: said("I couldn't make out that screen or camera frame, so please try again."),
  no_reply: said(`I didn't get an answer back, ${mayBeDone}.`),
  stopped: said(`Stopped, ${mayBeDone}.`),
  reply_too_long: said(`That got too long, so I stopped, ${mayBeDone}.`),
  did_not_catch: said("Sorry, I didn't catch that, so please say it again."),
  research_failed: said('Sorry, the research failed, so check the research window for details.'),
});

/** The words the web client itself uses when it cannot finish a turn; the server never sends these. Chat only. */
export const clientFailureCopy = Object.freeze({
  lost_connection: Object.freeze({ chat: `I lost the connection before the reply came back. ${checkFirst}` }),
  lost_track: Object.freeze({ chat: `I lost track of that reply. ${checkFirst}` }),
  unreadable_reply: Object.freeze({ chat: "I couldn't read that reply. Try again in a moment." }),
  not_sent: Object.freeze({ chat: "I couldn't send that message. Try again in a moment." }),
  not_saved: Object.freeze({ chat: "I couldn't save that message. Try again in a moment." }),
});
