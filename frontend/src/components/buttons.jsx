export function PrimaryButton({ children, className = "", ...props }) {
  return <button className={`button primary ${className}`} {...props}>{children}</button>;
}

export function GhostButton({ children, className = "", ...props }) {
  return <button className={`button ghost ${className}`} {...props}>{children}</button>;
}
