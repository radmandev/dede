import * as React from "react"

const TOAST_LIMIT = 5
const TOAST_REMOVE_DELAY = 1000

let count = 0
function genId() {
  count = (count + 1) % Number.MAX_VALUE
  return count.toString()
}

const toastTimeouts = new Map()
let listeners = []
let memoryState = { toasts: [] }

function dispatch(action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => listener(memoryState))
}

function reducer(state, action) {
  switch (action.type) {
    case "ADD_TOAST":
      return { ...state, toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) }
    case "UPDATE_TOAST":
      return { ...state, toasts: state.toasts.map((t) => t.id === action.toast.id ? { ...t, ...action.toast } : t) }
    case "DISMISS_TOAST": {
      const { toastId } = action
      if (toastId) {
        if (!toastTimeouts.has(toastId)) {
          toastTimeouts.set(toastId, setTimeout(() => {
            toastTimeouts.delete(toastId)
            dispatch({ type: "REMOVE_TOAST", toastId })
          }, TOAST_REMOVE_DELAY))
        }
      } else {
        state.toasts.forEach((t) => dispatch({ type: "DISMISS_TOAST", toastId: t.id }))
      }
      return { ...state, toasts: state.toasts.map((t) => !toastId || t.id === toastId ? { ...t, open: false } : t) }
    }
    case "REMOVE_TOAST":
      return { ...state, toasts: action.toastId ? state.toasts.filter((t) => t.id !== action.toastId) : [] }
    default:
      return state
  }
}

function toast({ ...props }) {
  const id = genId()
  const update = (props) => dispatch({ type: "UPDATE_TOAST", toast: { ...props, id } })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })
  dispatch({ type: "ADD_TOAST", toast: { ...props, id, open: true, onOpenChange: (open) => { if (!open) dismiss() } } })
  return { id, dismiss, update }
}

function useToast() {
  const [state, setState] = React.useState(memoryState)
  React.useEffect(() => {
    listeners.push(setState)
    return () => { listeners = listeners.filter((l) => l !== setState) }
  }, [])
  return { ...state, toast, dismiss: (toastId) => dispatch({ type: "DISMISS_TOAST", toastId }) }
}

export { useToast, toast }
