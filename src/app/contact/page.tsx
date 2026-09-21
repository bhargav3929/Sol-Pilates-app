"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Phone, MapPin, Clock, Send } from "lucide-react";
import { trackPixel } from "@/lib/meta-pixel";

const CONTACT_INFO = [
  {
    icon: Mail,
    label: "Email Us",
    value: "solpilatesstudio.in@gmail.com",
    href: "mailto:solpilatesstudio.in@gmail.com",
  },
  {
    icon: Phone,
    label: "Call Us",
    value: "+91 96420 04005",
    href: "tel:+919642004005",
  },
  {
    icon: MapPin,
    label: "Visit Us",
    value: "Kokapet Hyderabad, India",
    href: "#",
  },
  {
    icon: Clock,
    label: "Studio Hours",
    value: "Mon-Fri 5AM-11PM | Sat 6AM-10PM | Sun 7AM-9PM",
    href: null,
  },
];

export default function ContactPage() {
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    trackPixel("Lead", { content_name: "Contact Form" });
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 4000);
    setFormState({ name: "", email: "", phone: "", subject: "", message: "" });
  };

  return (
    <div className="min-h-screen bg-peach-200">
      {/* Hero */}
      <section className="relative pt-40 pb-20 bg-warmDark-800 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none flex items-center justify-center">
          <span className="text-[20vw] font-black text-peach-200 whitespace-nowrap font-display">CONTACT</span>
        </div>
        <div className="container mx-auto px-6 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <h1 className="text-5xl md:text-7xl font-black text-peach-200 tracking-normal font-display">
              GET IN TOUCH
            </h1>
            <p className="text-peach-400 mt-4 mx-auto tracking-wider text-sm">
              We&apos;d love to hear from you. Reach out for class bookings, questions, or just to say hello.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Info Cards */}
      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
            {CONTACT_INFO.map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
              >
                {item.href ? (
                  <a
                    href={item.href}
                    className="block p-8 bg-peach-300 border border-peach-400 hover:border-terra-400/30 transition-all group h-full"
                  >
                    <item.icon className="w-6 h-6 text-terra-400 mb-4 group-hover:scale-110 transition-transform" />
                    <h3 className="text-xs font-bold text-olive-300 tracking-wider uppercase mb-2">{item.label}</h3>
                    <p className="text-olive-600 font-medium text-sm leading-relaxed">{item.value}</p>
                  </a>
                ) : (
                  <div className="block p-8 bg-peach-300 border border-peach-400 h-full">
                    <item.icon className="w-6 h-6 text-terra-400 mb-4" />
                    <h3 className="text-xs font-bold text-olive-300 tracking-wider uppercase mb-2">{item.label}</h3>
                    <p className="text-olive-600 font-medium text-sm leading-relaxed">{item.value}</p>
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Google Maps */}
          <div className="mb-20 overflow-hidden border border-peach-400">
            <iframe
              title="SOL Pilates Studio location"
              src="https://www.google.com/maps?q=kokapet+hyderabad+india&output=embed"
              width="100%"
              height="400"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>

          {/* Contact Form + Map */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Form */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-3xl md:text-4xl font-black text-olive-600 tracking-normal mb-2 font-display">
                SEND US A MESSAGE
              </h2>
              <p className="text-olive-300 mb-8 text-sm">
                Fill out the form below and we&apos;ll get back to you within 24 hours.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-olive-300 tracking-wider uppercase mb-2" htmlFor="contact-name">Name</label>
                    <input
                      id="contact-name"
                      name="name"
                      type="text"
                      required
                      value={formState.name}
                      onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                      className="w-full bg-peach-300 border border-peach-400 px-4 py-3.5 text-olive-600 text-sm focus:outline-none focus:border-terra-400/50 transition-colors placeholder:text-olive-300/40"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-olive-300 tracking-wider uppercase mb-2" htmlFor="contact-email">Email</label>
                    <input
                      id="contact-email"
                      name="email"
                      type="email"
                      required
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                      className="w-full bg-peach-300 border border-peach-400 px-4 py-3.5 text-olive-600 text-sm focus:outline-none focus:border-terra-400/50 transition-colors placeholder:text-olive-300/40"
                      placeholder="your@email.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-olive-300 tracking-wider uppercase mb-2" htmlFor="contact-phone">Phone</label>
                    <input
                      id="contact-phone"
                      name="phone"
                      type="tel"
                      value={formState.phone}
                      onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                      className="w-full bg-peach-300 border border-peach-400 px-4 py-3.5 text-olive-600 text-sm focus:outline-none focus:border-terra-400/50 transition-colors placeholder:text-olive-300/40"
                      placeholder="(optional)"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-olive-300 tracking-wider uppercase mb-2" htmlFor="contact-subject">Subject</label>
                    <select
                      id="contact-subject"
                      name="subject"
                      value={formState.subject}
                      onChange={(e) => setFormState({ ...formState, subject: e.target.value })}
                      className="w-full bg-peach-300 border border-peach-400 px-4 py-3.5 text-olive-600 text-sm focus:outline-none focus:border-terra-400/50 transition-colors"
                    >
                      <option value="">Select a topic</option>
                      <option value="booking">Class Booking</option>
                      <option value="membership">Membership Enquiry</option>
                      <option value="private">Private Sessions</option>
                      <option value="general">General Question</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-olive-300 tracking-wider uppercase mb-2" htmlFor="contact-message">Message</label>
                  <textarea
                    id="contact-message"
                    name="message"
                    required
                    rows={5}
                    value={formState.message}
                    onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                    className="w-full bg-peach-300 border border-peach-400 px-4 py-3.5 text-olive-600 text-sm focus:outline-none focus:border-terra-400/50 transition-colors resize-none placeholder:text-olive-300/40"
                    placeholder="Tell us how we can help..."
                  />
                </div>

                <button
                  type="submit"
                  className="group inline-flex items-center gap-3 px-8 py-4 bg-terra-400 text-peach-50 font-black text-sm tracking-wider hover:bg-terra-300 transition-all"
                >
                  <span>SEND MESSAGE</span>
                  <Send className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {submitted && (
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-terra-400 font-bold text-sm"
                  >
                    Thank you! We&apos;ll be in touch soon.
                  </motion.p>
                )}
              </form>
            </motion.div>

            {/* Right side - Additional info */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="space-y-8"
            >
              <div className="bg-warmDark-800 p-10 relative overflow-hidden">
                <div className="absolute top-0 right-0 text-[8rem] font-black text-peach-200/[0.03] leading-none pointer-events-none font-display">
                  SOL
                </div>
                <h3 className="text-2xl font-black text-peach-200 mb-4 font-display">READY TO BEGIN?</h3>
                <p className="text-peach-400 text-sm leading-relaxed mb-6">
                  Whether you&apos;re new to Pilates or a seasoned practitioner, our team is here to guide you. Drop us a message or walk into our studio — your transformation starts with a single step.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-terra-400" />
                    <a href="mailto:solpilatesstudio.in@gmail.com" className="text-peach-200 text-sm hover:text-terra-300 transition-colors">
                      solpilatesstudio.in@gmail.com
                    </a>
                  </div>
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-terra-400" />
                    <a href="tel:+919642004005" className="text-peach-200 text-sm hover:text-terra-300 transition-colors">
                      +91 96420 04005
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-peach-300 border border-peach-400 p-10">
                <h3 className="text-xs font-bold text-olive-300 tracking-wider uppercase mb-4">STUDIO HOURS</h3>
                <div className="space-y-3">
                  {[
                    { day: "Monday - Friday", hours: "5:00 AM - 11:00 PM" },
                    { day: "Saturday", hours: "6:00 AM - 10:00 PM" },
                    { day: "Sunday", hours: "7:00 AM - 9:00 PM" },
                  ].map((item) => (
                    <div key={item.day} className="flex justify-between items-center py-2 border-b border-peach-400/30 last:border-0">
                      <span className="text-olive-400 text-sm font-medium">{item.day}</span>
                      <span className="text-olive-600 text-sm font-bold">{item.hours}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
