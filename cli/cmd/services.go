package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var servicesAll bool

var servicesCmd = &cobra.Command{
	Use:   "services",
	Short: "Manage docker services created by SFA agents",
}

var servicesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List running SFA-managed docker services",
	RunE:  runServicesList,
}

var servicesDownCmd = &cobra.Command{
	Use:   "down [agent-name]",
	Short: "Stop SFA-managed docker services",
	Long:  "Stop services for a specific agent, or all SFA services with --all.",
	RunE:  runServicesDown,
}

func init() {
	servicesDownCmd.Flags().BoolVar(&servicesAll, "all", false, "Stop all SFA-managed services")
	servicesCmd.AddCommand(servicesListCmd)
	servicesCmd.AddCommand(servicesDownCmd)
}

type containerInfo struct {
	ID     string            `json:"ID"`
	Names  string            `json:"Names"`
	Status string            `json:"Status"`
	Ports  string            `json:"Ports"`
	Labels map[string]string `json:"-"`

	// For display
	AgentName   string `json:"-"`
	ServiceName string `json:"-"`
}

func checkDocker() error {
	cmd := exec.Command("docker", "info")
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker is not available. Ensure Docker is installed and running")
	}
	return nil
}

func getSFAContainers() ([]containerInfo, error) {
	cmd := exec.Command("docker", "ps",
		"--filter", "label=sfa.agent",
		"--format", "{{json .}}",
	)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to query docker: %w", err)
	}

	var containers []containerInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}

		// Parse the JSON line — docker ps --format json gives flat fields
		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		c := containerInfo{
			ID:     getStr(raw, "ID"),
			Names:  getStr(raw, "Names"),
			Status: getStr(raw, "Status"),
			Ports:  getStr(raw, "Ports"),
		}

		// Parse labels to get agent name and service name
		labelsStr := getStr(raw, "Labels")
		labels := parseLabels(labelsStr)
		c.AgentName = labels["sfa.agent"]
		c.ServiceName = labels["com.docker.compose.service"]
		if c.ServiceName == "" {
			c.ServiceName = c.Names
		}

		containers = append(containers, c)
	}

	return containers, nil
}

func getStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func parseLabels(s string) map[string]string {
	labels := make(map[string]string)
	for _, pair := range strings.Split(s, ",") {
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) == 2 {
			labels[parts[0]] = parts[1]
		}
	}
	return labels
}

func runServicesList(cmd *cobra.Command, args []string) error {
	if err := checkDocker(); err != nil {
		return err
	}

	containers, err := getSFAContainers()
	if err != nil {
		return err
	}

	if len(containers) == 0 {
		fmt.Println("No SFA services running")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "AGENT\tSERVICE\tSTATUS\tPORTS")
	for _, c := range containers {
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", c.AgentName, c.ServiceName, c.Status, c.Ports)
	}
	_ = w.Flush()

	return nil
}

func runServicesDown(cmd *cobra.Command, args []string) error {
	if err := checkDocker(); err != nil {
		return err
	}

	if servicesAll {
		return stopAllServices()
	}

	if len(args) == 0 {
		return fmt.Errorf("specify an agent name or use --all")
	}

	return stopAgentServices(args[0])
}

func stopAgentServices(agentName string) error {
	// Use docker compose down with the agent's compose file
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to determine home directory: %w", err)
	}

	composeFile := filepath.Join(homeDir, ".local", "share", "single-file-agents", "services", agentName, "docker-compose.yml")

	if _, err := os.Stat(composeFile); os.IsNotExist(err) {
		return fmt.Errorf("no compose file found for agent %q at %s", agentName, composeFile)
	}

	c := exec.Command("docker", "compose", "-f", composeFile, "down", "-v")
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("failed to stop services for %s: %w", agentName, err)
	}

	fmt.Printf("Stopped services for %s\n", agentName)
	return nil
}

func stopAllServices() error {
	containers, err := getSFAContainers()
	if err != nil {
		return err
	}

	if len(containers) == 0 {
		fmt.Println("No SFA services running")
		return nil
	}

	// Collect container IDs
	var ids []string
	for _, c := range containers {
		ids = append(ids, c.ID)
	}

	// Stop and remove all SFA containers
	stopArgs := append([]string{"stop"}, ids...)
	c := exec.Command("docker", stopArgs...)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("failed to stop containers: %w", err)
	}

	rmArgs := append([]string{"rm", "-f", "-v"}, ids...)
	c = exec.Command("docker", rmArgs...)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("failed to remove containers: %w", err)
	}

	fmt.Printf("Stopped %d SFA container(s)\n", len(ids))
	return nil
}
