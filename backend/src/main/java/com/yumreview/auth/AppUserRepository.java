package com.yumreview.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.List;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByEmailNormalized(String emailNormalized);

    boolean existsByEmailNormalized(String emailNormalized);

    long countBySystemRole(String systemRole);

    List<AppUser> findAllBySystemRoleOrderByIdAsc(String systemRole);

    List<AppUser> findTop10ByEmailNormalizedContainingOrderByEmailNormalizedAsc(String emailFragment);
}
