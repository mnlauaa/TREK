# Separate visit timing from bookings

A stay belongs to a visit, while the place supplies only its default. Fixed visit times and booking times remain independently owned inputs; reachable times are derived and never written back into either. This preserves repeated visits and reservation details when travel makes the plan impossible, at the cost of displaying a warning beside a distinct prediction.
