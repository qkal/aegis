/**
 * Event priority tiers for session snapshot budget allocation.
 *
 * When context is compacted, events are preserved in priority order.
 * CRITICAL events are always included; LOW events are dropped first.
 */
export const EventPriority = {
	CRITICAL: 0,
	HIGH: 1,
	NORMAL: 2,
	LOW: 3,
} as const;

export type EventPriority = (typeof EventPriority)[keyof typeof EventPriority];
