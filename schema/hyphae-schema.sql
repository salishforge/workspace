-- Hyphae Service Registry Schema
-- PostgreSQL tables for persistent service registration

CREATE TABLE IF NOT EXISTS hyphae_services (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  registered_at TIMESTAMP DEFAULT NOW(),
  last_heartbeat TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hyphae_capabilities (
  id SERIAL PRIMARY KEY,
  service_id VARCHAR(255) NOT NULL REFERENCES hyphae_services(id) ON DELETE CASCADE,
  capability_name VARCHAR(255) NOT NULL,
  UNIQUE(service_id, capability_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_hyphae_services_owner ON hyphae_services(owner);
CREATE INDEX IF NOT EXISTS idx_hyphae_services_heartbeat ON hyphae_services(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_hyphae_capabilities_name ON hyphae_capabilities(capability_name);

-- Permissions (for memforge_user or equivalent)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON hyphae_services, hyphae_capabilities TO memforge_user;
-- GRANT USAGE, SELECT ON SEQUENCE hyphae_capabilities_id_seq TO memforge_user;

-- Example queries:

-- Register a service
-- INSERT INTO hyphae_services (id, type, endpoint, owner)
-- VALUES ('memforge-1', 'memory', 'http://localhost:3333', 'tidepool-flint')
-- ON CONFLICT (id) DO UPDATE SET last_heartbeat = NOW();

-- Find all services with capability
-- SELECT DISTINCT s.id, s.type, s.endpoint
-- FROM hyphae_services s
-- JOIN hyphae_capabilities c ON s.id = c.service_id
-- WHERE c.capability_name = 'code-review';

-- Update heartbeat
-- UPDATE hyphae_services SET last_heartbeat = NOW() WHERE id = $1;

-- Cleanup stale services
-- DELETE FROM hyphae_services
-- WHERE last_heartbeat < NOW() - INTERVAL '1 hour';
