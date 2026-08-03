// backend/whatsappConversationManager.js

// Simple in-memory store for conversation state.
// In a production environment, this should be replaced with a more persistent store like Redis.
const conversationStates = new Map();

/**
 * Sets the conversation state for a given phone number.
 * @param {string} phone - The user's phone number (e.g., '6281234567890').
 * @param {string} step - The current step of the conversation (e.g., 'awaiting_new_password').
 * @param {object} [data={}] - Optional data to store with the state.
 */
const setConversationState = (phone, step, data = {}) => {
    conversationStates.set(phone, { step, data, timestamp: Date.now() });
    console.log(`[Whatsapp Conversation] State for ${phone} set to: ${step}`);
};

/**
 * Gets the current conversation state for a phone number.
 * @param {string} phone - The user's phone number.
 * @returns {object | null} The state object or null if none exists.
 */
const getConversationState = (phone) => {
    return conversationStates.get(phone) || null;
};

/**
 * Clears the conversation state for a phone number.
 * @param {string} phone - The user's phone number.
 */
const clearConversationState = (phone) => {
    conversationStates.delete(phone);
    console.log(`[Whatsapp Conversation] State for ${phone} cleared.`);
};

// Clean up old conversation states periodically to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    const expiryTime = 15 * 60 * 1000; // 15 minutes
    for (const [phone, state] of conversationStates.entries()) {
        if (now - state.timestamp > expiryTime) {
            conversationStates.delete(phone);
            console.log(`[Whatsapp Conversation] Cleared expired state for ${phone}`);
        }
    }
}, 5 * 60 * 1000); // Run every 5 minutes

export default {
    setConversationState,
    getConversationState,
    clearConversationState,
};
