// LinkedIn DOM selectors — last verified 2026-05-30.
// LinkedIn changes these periodically. When a send fails with selector_missing,
// update the relevant selector here and rebuild.
export const SEL = {
  messageButton: 'button[aria-label^="Message"]',
  composeEditor: 'div.msg-form__contenteditable[contenteditable="true"]',
  composeSendButton: 'button.msg-form__send-button',
  checkpointMarker: '[data-test-id="checkpoint"]',
  conversationMessages: 'li.msg-s-message-list__event',
  messageAuthor: '.msg-s-message-group__name',
  messageBody: '.msg-s-event-listitem__body',
  messageTimestamp: 'time',
} as const;
