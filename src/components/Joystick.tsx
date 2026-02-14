import React, { useRef, useEffect, useState } from 'react'
import './Joystick.css'

interface JoystickProps {
  onMove: (x: number, y: number) => void
  size?: number
  baseColor?: string
  stickColor?: string
}

export const Joystick: React.FC<JoystickProps> = ({
  onMove,
  size = 100,
  baseColor = 'rgba(255, 255, 255, 0.1)',
  stickColor = 'rgba(255, 255, 255, 0.5)',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const currentPosRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleStart = (clientX: number, clientY: number) => {
      setActive(true)
      const rect = container.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      dragStartRef.current = { x: centerX, y: centerY }
      updatePosition(clientX, clientY)
    }

    const handleMove = (clientX: number, clientY: number) => {
      if (!active || !dragStartRef.current) return
      updatePosition(clientX, clientY)
    }

    const handleEnd = () => {
      setActive(false)
      dragStartRef.current = null
      currentPosRef.current = { x: 0, y: 0 }
      setPosition({ x: 0, y: 0 })
      onMove(0, 0)
    }

    const updatePosition = (clientX: number, clientY: number) => {
      if (!dragStartRef.current) return

      const maxDist = size / 2
      let dx = clientX - dragStartRef.current.x
      let dy = clientY - dragStartRef.current.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > maxDist) {
        const ratio = maxDist / dist
        dx *= ratio
        dy *= ratio
      }

      currentPosRef.current = { x: dx, y: dy }
      setPosition({ x: dx, y: dy })

      // Normalize output -1 to 1
      onMove(dx / maxDist, -dy / maxDist) // Invert Y for standard joystick (up is positive)
    }

    // Touch Events
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0]
      handleStart(touch.clientX, touch.clientY)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return
      e.preventDefault()
      const touch = e.touches[0]
      handleMove(touch.clientX, touch.clientY)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (active) {
        e.preventDefault()
        handleEnd()
      }
    }

    // Mouse Events
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      handleStart(e.clientX, e.clientY)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (active) {
        e.preventDefault()
        handleMove(e.clientX, e.clientY)
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (active) {
        e.preventDefault()
        handleEnd()
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)

    container.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)

      container.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [active, onMove, size])

  return (
    <div
      ref={containerRef}
      className={`joystick-base ${active ? 'active' : ''}`}
      style={{
        width: size,
        height: size,
        backgroundColor: baseColor,
        borderRadius: '50%',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <div
        ref={stickRef}
        className="joystick-stick"
        style={{
          width: size / 2,
          height: size / 2,
          backgroundColor: stickColor,
          borderRadius: '50%',
          position: 'absolute',
          top: '50%',
          left: '50%',
          marginTop: -size / 4,
          marginLeft: -size / 4,
          transform: `translate(${position.x}px, ${position.y}px)`,
          transition: active ? 'none' : 'transform 0.2s ease-out',
        }}
      />
    </div>
  )
}
