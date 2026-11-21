/** If a tool may have run, Dan has to look before he asks again; the clean variants below say nothing ran. */
const checkFirst = 'If you asked me to do something, it may already have happened, so check before you try again.';

/**
 * What Dan reads in Chat and hears in Voice when a turn does not finish: plain first-person English that says what happened and what
 * he can do. Never an internal name (PI, Foundry, gateway, harness, MCP, approval) and never a status code. The technical code and
 * detail stay on the error for the log. Voice gets one short sentence. The backend sends these words; the web recognises exactly
 * these words; `failure-copy.test.js` keeps every entry plain.
 */
export const failureCopy = Object.freeze({
  not_set_up: Object.freeze({
    chat: "I can't answer yet because my setup isn't finished. Nothing was sent.",
    voice: "I can't answer yet because my setup isn't finished.",
  }),
  allowance_used: Object.freeze({
    chat: "I've used this month's allowance, so I didn't send that. Raise the limit or wait until next month.",
    voice: "I've used this month's allowance, so I can't answer until it resets.",
  }),
  sign_in_failed: Object.freeze({
    chat: "I couldn't sign in to the AI service, so nothing was sent. If it keeps happening, my access needs fixing.",
    voice: "I couldn't sign in to the AI service, so I can't answer right now.",
  }),
  agent_missing: Object.freeze({
    chat: "I couldn't find my conversation in the AI service, so nothing was sent. Try again; if it keeps happening, my setup needs to be run again.",
    voice: "I couldn't find my conversation in the AI service, so please try again.",
  }),
  service_busy: Object.freeze({
    chat: 'The AI service is busy right now. Try again in a moment.',
    voice: 'The AI service is busy, so please try again in a moment.',
  }),
  service_problem: Object.freeze({
    chat: "The AI service had a problem and couldn't run that. Try again in a moment.",
    voice: 'The AI service had a problem, so please try again in a moment.',
  }),
  unreachable: Object.freeze({
    chat: "I couldn't reach the AI service. Try again in a moment.",
    voice: "I couldn't reach the AI service, so please try again in a moment.",
  }),
  no_answer_in_time: Object.freeze({
    chat: "The AI service didn't answer in time. Try again in a moment.",
    voice: "The AI service didn't answer in time, so please try again.",
  }),
  no_conversation: Object.freeze({
    chat: "I couldn't start a conversation with the AI service. Try again in a moment.",
    voice: "I couldn't start a conversation with the AI service, so please try again.",
  }),
  no_reply_stream: Object.freeze({
    chat: 'The AI service sent nothing back. Try again in a moment.',
    voice: 'The AI service sent nothing back, so please try again.',
  }),
  cut_off: Object.freeze({
    chat: `I couldn't finish that reply. ${checkFirst}`,
    voice: "Sorry, I couldn't finish that, and part of it may already be done.",
  }),
  cut_off_clean: Object.freeze({
    chat: "I couldn't finish that reply, but nothing was done. Try again.",
    voice: "Sorry, I couldn't finish that, so please try again.",
  }),
  took_too_long: Object.freeze({
    chat: `That took too long, so I stopped. ${checkFirst}`,
    voice: 'That took too long, so I stopped, and part of it may already be done.',
  }),
  took_too_long_clean: Object.freeze({
    chat: 'That took too long, so I stopped. Nothing was done, so try again.',
    voice: 'That took too long and I stopped, so please try again.',
  }),
  still_answering: Object.freeze({
    chat: "I'm still answering your last message. Wait for it to finish, then try again.",
    voice: "I'm still answering your last question, so please wait a moment.",
  }),
  cannot_see_frame: Object.freeze({
    chat: "I couldn't make out that screen or camera frame, so nothing was sent. Try again.",
    voice: "I couldn't make out that screen or camera frame, so please try again.",
  }),
  no_reply: Object.freeze({
    chat: `I didn't get an answer back. ${checkFirst}`,
    voice: "Sorry, I didn't get an answer back for that.",
  }),
  stopped: Object.freeze({
    chat: `Stopped. ${checkFirst}`,
    voice: 'Stopped.',
  }),
  reply_too_long: Object.freeze({
    chat: `That reply got too long, so I stopped it. ${checkFirst}`,
    voice: 'That got too long, so I stopped.',
  }),
  did_not_catch: Object.freeze({
    chat: "Sorry, I didn't catch that, so please say it again.",
    voice: "Sorry, I didn't catch that, so please say it again.",
  }),
  research_failed: Object.freeze({
    chat: 'Sorry, the research failed, so check the research window for details.',
    voice: 'Sorry, the research failed, so check the research window for details.',
  }),
});

/** The words the web client itself uses when it cannot finish a turn; the server never sends these. Chat only. */
export const clientFailureCopy = Object.freeze({
  lost_connection: Object.freeze({ chat: `I lost the connection before the reply came back. ${checkFirst}` }),
  lost_track: Object.freeze({ chat: `I lost track of that reply. ${checkFirst}` }),
  unreadable_reply: Object.freeze({ chat: "I couldn't read that reply. Try again in a moment." }),
  not_sent: Object.freeze({ chat: "I couldn't send that message. Try again in a moment." }),
  not_saved: Object.freeze({ chat: "I couldn't save that message. Try again in a moment." }),
});
