variable "aws_region" {
  description = "AWS region for the S3 origin."
  type        = string
  default     = "ap-southeast-2"
}

variable "project_name" {
  description = "Resource name prefix. Use a different name for each environment."
  type        = string
  default     = "stac-explorer"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.project_name))
    error_message = "Use 3–30 lowercase letters, numbers, or hyphens; start with a letter and end with a letter or number."
  }
}
