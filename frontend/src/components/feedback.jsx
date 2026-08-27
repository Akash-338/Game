import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, X } from "lucide-react";

export function ErrorToast({ error, onClose }) { return <AnimatePresence>{error && <motion.div className="error-toast" role="alert" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}><CircleAlert size={18}/><span>{error}</span><button onClick={onClose} aria-label="Close error"><X size={16}/></button></motion.div>}</AnimatePresence>; }
