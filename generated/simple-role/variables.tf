variable "assume_role_policy" {
  description = "Trust policy for the IAM role (JSON)"
  type        = string
}
variable "policy_document" {
  description = "IAM policy document (JSON)"
  type        = string
}
variable "policy_name" {
  description = "Name of the IAM policy"
  type        = string
}
variable "role_name" {
  description = "Name of the IAM role"
  type        = string
}
variable "tags" {
  description = "Tags for resources"
  type        = map(string)
  default     = {}
}
