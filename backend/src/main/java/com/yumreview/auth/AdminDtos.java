package com.yumreview.auth;

import jakarta.validation.constraints.NotNull;

public final class AdminDtos {
    private AdminDtos() { }

    public record AssignOwnerRequest(@NotNull Long userId) { }
    public record OwnerAssignment(Long userId, String email, Long restaurantId) { }
    public record UserOption(Long userId, String email) { }
    public record OperationResult(String message) { }
}
