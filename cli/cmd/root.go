package cmd

import (
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "sfa",
	Short: "Single-File Agents CLI",
	Long:  "CLI tool for scaffolding, validating, and managing single-file agents.",
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(validateCmd)
	rootCmd.AddCommand(servicesCmd)
}
