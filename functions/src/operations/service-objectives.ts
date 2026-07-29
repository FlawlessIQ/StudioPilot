export type QueueObjective = {
  targetStartSeconds: number;
  warningBacklog: number;
  criticalBacklog: number;
  maxDeadLetters: number;
};

export const queueObjectives = {
  providerJobs: {
    targetStartSeconds: 120,
    warningBacklog: 25,
    criticalBacklog: 100,
    maxDeadLetters: 0,
  },
  emailJobs: {
    targetStartSeconds: 60,
    warningBacklog: 50,
    criticalBacklog: 250,
    maxDeadLetters: 0,
  },
  aiJobs: {
    targetStartSeconds: 180,
    warningBacklog: 20,
    criticalBacklog: 75,
    maxDeadLetters: 0,
  },
  pdfJobs: {
    targetStartSeconds: 180,
    warningBacklog: 20,
    criticalBacklog: 75,
    maxDeadLetters: 0,
  },
  automationRuns: {
    targetStartSeconds: 300,
    warningBacklog: 50,
    criticalBacklog: 200,
    maxDeadLetters: 0,
  },
  domainEvents: {
    targetStartSeconds: 120,
    warningBacklog: 100,
    criticalBacklog: 500,
    maxDeadLetters: 0,
  },
} as const satisfies Record<string, QueueObjective>;

export type QueueHealthInput = {
  backlog: number;
  deadLetters: number;
  oldestCreatedAt: string | null;
  now: Date;
  objective: QueueObjective;
};

export type QueueHealth = {
  status: "healthy" | "degraded" | "critical";
  oldestAgeSeconds: number;
  objectiveBreached: boolean;
};

export function evaluateQueueHealth(input: QueueHealthInput): QueueHealth {
  const oldest = input.oldestCreatedAt
    ? new Date(input.oldestCreatedAt)
    : input.now;
  const oldestAgeSeconds = Number.isNaN(oldest.valueOf())
    ? 0
    : Math.max(
        0,
        Math.round((input.now.valueOf() - oldest.valueOf()) / 1000),
      );
  const objectiveBreached =
    oldestAgeSeconds > input.objective.targetStartSeconds ||
    input.backlog >= input.objective.warningBacklog ||
    input.deadLetters > input.objective.maxDeadLetters;
  const critical =
    input.backlog >= input.objective.criticalBacklog ||
    input.deadLetters > Math.max(2, input.objective.maxDeadLetters);
  return {
    status: critical ? "critical" : objectiveBreached ? "degraded" : "healthy",
    oldestAgeSeconds,
    objectiveBreached,
  };
}

export const runtimeCapacityProfiles = {
  appHosting: {
    minInstances: 0,
    maxInstances: 10,
    concurrency: 80,
    memoryMiB: 512,
  },
  taskWorker: {
    maxConcurrentDispatches: 20,
    maxDispatchesPerSecond: 10,
    timeoutSeconds: 600,
    memoryMiB: 1024,
  },
  pdfWorker: {
    minInstances: 0,
    maxInstances: 4,
    concurrency: 4,
    memoryMiB: 1024,
  },
  fileSafetyWorker: {
    minInstances: 0,
    maxInstances: 4,
    concurrency: 2,
    memoryMiB: 2048,
  },
} as const;
