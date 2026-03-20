export default function PageHeader({
  icon,
  title,
  subtitle,
}: {
  icon: string
  title: string
  subtitle?: string
}) {
  return (
    <div className="sp-page-header">
      <div className="sp-page-title">
        {icon} {title}
      </div>
      {subtitle ? <div className="sp-page-subtitle">{subtitle}</div> : null}
    </div>
  )
}

