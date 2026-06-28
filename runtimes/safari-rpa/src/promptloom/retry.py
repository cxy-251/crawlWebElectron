from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PromptLoomRetryPolicy:
    retries: int = 1
    initial_delay: float = 0.5
    multiplier: float = 2.0
    maximum_delay: float = 5.0

    @property
    def attempts(self) -> int:
        return max(1, self.retries + 1)

    def delay(self, attempt: int) -> float:
        return min(self.maximum_delay, self.initial_delay * (self.multiplier ** max(0, attempt - 1)))
