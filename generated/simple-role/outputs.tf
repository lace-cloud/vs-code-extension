output "policy_arn" {
  description = "ARN of the IAM policy"
  value       = module.policy.policy_arn
}
output "role_arn" {
  description = "ARN of the IAM role"
  value       = module.role.role_arn
}
output "role_name" {
  description = "Name of the IAM role"
  value       = module.role.role_name
}
