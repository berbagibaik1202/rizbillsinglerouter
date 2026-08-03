let lastPingEvent = null;

export const updateDigiflazzPingEvent = (pingEvent) => {
    lastPingEvent = {
        ...pingEvent,
        receivedAt: new Date().toISOString(),
    };
};

export const getLastDigiflazzPing = () => lastPingEvent;
