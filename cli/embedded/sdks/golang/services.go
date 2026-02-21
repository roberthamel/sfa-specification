package sfa

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// checkDockerAvailability verifies that Docker and Docker Compose are available.
func checkDockerAvailability() error {
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("Docker is not installed or not in PATH. Install Docker to use service dependencies")
	}

	cmd := exec.Command("docker", "compose", "version")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Docker Compose is not available. Install Docker Compose to use service dependencies")
	}

	return nil
}

// materializeCompose writes a Docker Compose YAML file from agent service definitions.
// Returns the file path.
func materializeCompose(agentName, version string, services map[string]ServiceDef) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to determine home directory: %w", err)
	}

	dir := filepath.Join(home, ".local", "share", "single-file-agents", "services", agentName)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("failed to create services directory: %w", err)
	}

	composePath := filepath.Join(dir, "compose.yaml")

	// Build YAML content
	var b strings.Builder
	b.WriteString("services:\n")

	for name, svc := range services {
		b.WriteString(fmt.Sprintf("  %s:\n", name))
		b.WriteString(fmt.Sprintf("    image: %s\n", svc.Image))

		if len(svc.Ports) > 0 {
			b.WriteString("    ports:\n")
			for _, p := range svc.Ports {
				b.WriteString(fmt.Sprintf("      - %q\n", p))
			}
		}

		if len(svc.Environment) > 0 {
			b.WriteString("    environment:\n")
			for k, v := range svc.Environment {
				// Interpolate ${VAR} from process env
				expanded := os.ExpandEnv(v)
				b.WriteString(fmt.Sprintf("      %s: %q\n", k, expanded))
			}
		}

		if len(svc.Volumes) > 0 {
			b.WriteString("    volumes:\n")
			for _, v := range svc.Volumes {
				b.WriteString(fmt.Sprintf("      - %q\n", v))
			}
		}

		if svc.Command != nil {
			switch cmd := svc.Command.(type) {
			case string:
				b.WriteString(fmt.Sprintf("    command: %s\n", cmd))
			case []string:
				b.WriteString("    command:\n")
				for _, c := range cmd {
					b.WriteString(fmt.Sprintf("      - %q\n", c))
				}
			}
		}

		if svc.Healthcheck != nil {
			b.WriteString("    healthcheck:\n")
			b.WriteString(fmt.Sprintf("      test: %s\n", svc.Healthcheck.Test))
			if svc.Healthcheck.Interval != "" {
				b.WriteString(fmt.Sprintf("      interval: %s\n", svc.Healthcheck.Interval))
			}
			if svc.Healthcheck.Timeout != "" {
				b.WriteString(fmt.Sprintf("      timeout: %s\n", svc.Healthcheck.Timeout))
			}
			if svc.Healthcheck.Retries > 0 {
				b.WriteString(fmt.Sprintf("      retries: %d\n", svc.Healthcheck.Retries))
			}
			if svc.Healthcheck.StartPeriod != "" {
				b.WriteString(fmt.Sprintf("      start_period: %s\n", svc.Healthcheck.StartPeriod))
			}
		}

		// Add SFA labels
		b.WriteString("    labels:\n")
		b.WriteString(fmt.Sprintf("      sfa.agent: %q\n", agentName))
		b.WriteString(fmt.Sprintf("      sfa.version: %q\n", version))
	}

	content := b.String()
	if err := os.WriteFile(composePath, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("failed to write compose file: %w", err)
	}

	return composePath, nil
}

// composeHash returns a SHA256 hash of the compose content for change detection.
func composeHash(content string) string {
	h := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%x", h)
}

// startServices starts Docker Compose services for an agent.
func startServices(agentName, version string, services map[string]ServiceDef, env *ResolvedEnv) error {
	if len(services) == 0 {
		return nil
	}

	// Check which services are externally configured
	allExternal := true
	for name := range services {
		upperName := strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
		urlKey := fmt.Sprintf("SFA_SVC_%s_URL", upperName)
		hostKey := fmt.Sprintf("SFA_SVC_%s_HOST", upperName)
		if os.Getenv(urlKey) == "" && os.Getenv(hostKey) == "" {
			allExternal = false
			break
		}
	}

	if allExternal {
		return nil // all services externally configured
	}

	// Check Docker availability
	if err := checkDockerAvailability(); err != nil {
		return err
	}

	// Materialize compose file
	composePath, err := materializeCompose(agentName, version, services)
	if err != nil {
		return err
	}

	// Start services
	cmd := exec.Command("docker", "compose", "-f", composePath, "up", "-d")
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to start services: %w", err)
	}

	// Wait for healthy
	if err := waitForHealthy(agentName, composePath, 60); err != nil {
		return err
	}

	// Inject SFA_SVC_* variables
	injectServiceVars(agentName, services, composePath)

	return nil
}

// waitForHealthy polls Docker Compose until all services are healthy or running.
func waitForHealthy(agentName, composePath string, timeoutSeconds int) error {
	deadline := time.Now().Add(time.Duration(timeoutSeconds) * time.Second)

	for time.Now().Before(deadline) {
		cmd := exec.Command("docker", "compose", "-f", composePath, "ps", "--format", "{{.Status}}")
		out, err := cmd.Output()
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}

		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		allReady := true
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			lower := strings.ToLower(line)
			if !strings.Contains(lower, "healthy") && !strings.HasPrefix(lower, "up") {
				allReady = false
				break
			}
		}

		if allReady && len(lines) > 0 && lines[0] != "" {
			return nil
		}

		time.Sleep(2 * time.Second)
	}

	// Timeout — dump logs for debugging
	dumpCmd := exec.Command("docker", "compose", "-f", composePath, "logs", "--tail", "50")
	dumpCmd.Stdout = os.Stderr
	dumpCmd.Stderr = os.Stderr
	dumpCmd.Run()

	return fmt.Errorf("services failed to become healthy within %d seconds", timeoutSeconds)
}

// injectServiceVars sets SFA_SVC_* environment variables for running services.
func injectServiceVars(agentName string, services map[string]ServiceDef, composePath string) {
	for name, svc := range services {
		upperName := strings.ToUpper(strings.ReplaceAll(name, "-", "_"))

		// Default host and port from compose port mappings
		host := "localhost"
		port := ""
		if len(svc.Ports) > 0 {
			parts := strings.Split(svc.Ports[0], ":")
			if len(parts) >= 2 {
				port = parts[0]
			}
		}

		os.Setenv(fmt.Sprintf("SFA_SVC_%s_HOST", upperName), host)
		if port != "" {
			os.Setenv(fmt.Sprintf("SFA_SVC_%s_PORT", upperName), port)
			os.Setenv(fmt.Sprintf("SFA_SVC_%s_URL", upperName), fmt.Sprintf("%s:%s", host, port))
		}
	}
}

// stopServices stops Docker Compose services.
func stopServices(agentName string, lifecycle ServiceLifecycle, services map[string]ServiceDef) {
	if lifecycle == ServicePersistent || len(services) == 0 {
		return
	}

	composeDown(agentName)
}

// composeDown tears down Docker Compose services for an agent.
func composeDown(agentName string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	dir := filepath.Join(home, ".local", "share", "single-file-agents", "services", agentName)

	// Try modern name first, then legacy
	for _, name := range []string{"compose.yaml", "docker-compose.yml"} {
		composePath := filepath.Join(dir, name)
		if _, err := os.Stat(composePath); err == nil {
			cmd := exec.Command("docker", "compose", "-f", composePath, "down", "-v")
			cmd.Stdout = os.Stderr
			cmd.Stderr = os.Stderr
			cmd.Run()
			return
		}
	}
}

// handleServicesDown handles the --services-down flag.
func handleServicesDown(agentName string) {
	composeDown(agentName)
	emitProgress(agentName, "services stopped")
	os.Exit(ExitSuccess)
}
