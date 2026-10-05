import { useEffect, useState } from "react";
import WaveAnimation from "./WaveAnimation.jsx";
import { motion } from "framer-motion";
import {
  ArrowRight, BadgeCheck, Building2, CheckCircle2, ChevronUp, Cloud,
  Code2, Cpu, Database, Globe2, HardDrive, LockKeyhole, Menu, Network,
  Radar, Server, ShieldCheck, Sparkles, Users, X
} from "lucide-react";
import ContactForm from "./ContactForm.jsx";
import BrandLogo from "./BrandLogo.jsx";

const services = [
  { icon: Network, title: "Network Security", text: "Secure architecture, segmentation, wireless security, VPNs, DNS protection, traffic monitoring, and vulnerability remediation." },
  { icon: Users, title: "Active Directory & Identity", text: "Active Directory administration, Group Policy, Microsoft Entra ID, MFA strategy, privilege reduction, and account lifecycle management." },
  { icon: ShieldCheck, title: "Perimeter Security", text: "Firewalls, internet-facing service reviews, secure remote access, TLS/SSL, DNS security, and attack-surface reduction." },
  { icon: HardDrive, title: "Endpoint Security", text: "Security and management for Windows, macOS, and Linux endpoints including hardening, EDR, patching, monitoring, and incident response." },
  { icon: Cloud, title: "Cloud Security", text: "Security architecture and operations across Microsoft Azure, AWS, and Google Cloud Platform with IAM, logging, workload protection, and configuration reviews." },
  { icon: Cpu, title: "AI Agent Security", text: "Security reviews for AI agents, permissions, prompt injection, sensitive-data exposure, tool access, APIs, and secure enterprise AI workflows." },
  { icon: Radar, title: "AI-Based Adversary Defense", text: "Modern threat detection, behavioral analysis, automated response, identity threat monitoring, phishing defense, and adversary-focused security operations." },
  { icon: Server, title: "On-Prem & Physical Security", text: "Security camera systems, NVRs, server security, physical access technology, infrastructure protection, and secure remote connectivity." },
  { icon: Code2, title: "Website Design & Management", text: "Responsive business websites, WordPress, hosting, DNS, TLS/SSL, security, maintenance, backups, content updates, and performance optimization." },
  { icon: Building2, title: "Managed IT & Consulting", text: "Ongoing technology support, strategic consulting, project implementation, managed infrastructure, and security-first operational guidance." },
];

const team = [
  { name: "Aaron Celestin", role: "Founder & CEO", bio: "Leads cybersecurity, infrastructure, cloud, identity, endpoint, web security, and emerging AI security engagements." },
  { name: "Melissa Celestin", role: "Senior Consultant", bio: "Supports client technology initiatives, project planning, business requirements, and consulting engagements." },
  { name: "Joselyn Medina Cruz", role: "Technical Analyst", bio: "Supports infrastructure, technical planning, implementation, troubleshooting, and ongoing client technology operations." },
  { name: "Adrien Celestin", role: "Technical Consultant", bio: "Supports implementation, systems management, troubleshooting, and day-to-day client technology projects." },
];

const cases = [
  {
    name: "Florida Springs Health and Wellness",
    eyebrow: "Long-term managed technology support",
    text: "Provided ongoing management and support for security camera infrastructure, servers, and endpoint systems, helping maintain reliable and secure business operations over multiple years.",
    tags: ["Security Cameras", "Servers", "Endpoints", "Support"],
  },
  {
    name: "PassingYourOBGYNBoards.com",
    eyebrow: "Website design and ongoing management",
    text: "Designed and continue to manage the website, including hosting, security, maintenance, updates, infrastructure administration, and ongoing technical support.",
    tags: ["Web Design", "Hosting", "Security", "Maintenance"],
  },
];

const highlights = [
  "Security-first architecture",
  "Cloud, endpoint, and identity expertise",
  "Ongoing managed services",
  "Practical solutions for real business environments",
];

function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener("scroll", onScroll);
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeNav = () => setMobileOpen(false);

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" onClick={closeNav}>
            <span className="brand-mark"><BrandLogo size={24} /></span>
            <span><strong>Celestin Industries</strong><small>Technology and Security Consulting</small></span>
          </a>

          <nav className={`nav-links ${mobileOpen ? "open" : ""}`}>
            <a href="#services" onClick={closeNav}>Services</a>
            <a href="#ai-security" onClick={closeNav}>AI Security</a>
            <a href="#about" onClick={closeNav}>About</a>
            <a href="#clients" onClick={closeNav}>Client Experience</a>
            <a href="#contact" onClick={closeNav}>Contact</a>
            <a href="#contact" className="nav-cta" onClick={closeNav}>Request a Consultation</a>
          </nav>

          <button className="menu-button" aria-label="Toggle menu" onClick={() => setMobileOpen(v => !v)}>
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <main>
        <section id="home" className="hero section">
          {/* Full-width animated background */}
          <div className="hero-wave-background" aria-hidden="true"><WaveAnimation /></div>

          {/* Contrast layer for readable text */}
          <div className="hero-contrast-overlay" aria-hidden="true"/>
          <div className="hero-grid container">
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="eyebrow"><Sparkles size={16} /> Security-first technology consulting</div>
              <h1>Secure technology. Practical solutions. Built for your business.</h1>
              <p className="hero-copy">
                Managed IT, cybersecurity, cloud, identity, endpoint, network, physical security,
                AI security, and website services for organizations that need dependable technology
                without unnecessary complexity.
              </p>

              <div className="hero-actions">
                <a href="#contact" className="button primary">Request a Consultation <ArrowRight size={18} /></a>
                <a href="#services" className="button secondary">Explore Services</a>
              </div>

              <div className="hero-points">
                {highlights.map(item => <span key={item}><CheckCircle2 size={17} /> {item}</span>)}
              </div>
            </motion.div>

            
          </div>
        </section>

        <section className="trust-strip">
          <div className="container trust-grid">
            <div><strong>Security-first</strong><span>Not security as an afterthought</span></div>
            <div><strong>Cross-platform</strong><span>Windows · macOS · Linux</span></div>
            <div><strong>Multi-cloud</strong><span>Azure · AWS · GCP</span></div>
            <div><strong>Full-stack support</strong><span>Network · Identity · Web · AI</span></div>
          </div>
        </section>

        <section id="services" className="section">
          <div className="container">
            <div className="section-heading">
              <span className="kicker">What we do</span>
              <h2>One partner for security, infrastructure, cloud, and web.</h2>
              <p>We help organizations reduce risk, modernize systems, and manage the technology that keeps their business operating.</p>
            </div>

            <div className="services-grid">
              {services.map(({ icon: Icon, title, text }, index) => (
                <motion.article className="service-card" key={title} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.45, delay: index * 0.03 }}>
                  <div className="icon-wrap"><Icon size={24} /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section id="ai-security" className="section alt-section">
          <div className="container split-layout">
            <div>
              <span className="kicker">AI Security</span>
              <h2>Secure AI before it becomes part of your attack surface.</h2>
              <p>AI agents increasingly connect to business systems, cloud platforms, APIs, documents, email, and sensitive data. We help organizations use AI safely while reducing risks from excessive permissions, prompt injection, insecure integrations, and autonomous actions.</p>
              <ul className="check-list">
                <li><CheckCircle2 /> AI agent permission and identity reviews</li>
                <li><CheckCircle2 /> Prompt-injection and data-exposure risk reduction</li>
                <li><CheckCircle2 /> Secure enterprise AI workflow design</li>
                <li><CheckCircle2 /> AI-assisted monitoring and adversary defense</li>
              </ul>
            </div>

            <div className="ai-visual" aria-label="AI security diagram">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="ai-core"><Cpu size={54} /><span>AI Security</span></div>
              <div className="orbit-label one">Identity</div>
              <div className="orbit-label two">Data</div>
              <div className="orbit-label three">Tools</div>
              <div className="orbit-label four">APIs</div>
            </div>
          </div>
        </section>

        <section id="about" className="section">
          <div className="container">
            <div className="section-heading">
              <span className="kicker">About us</span>
              <h2>Hands-on technical experience with a security-first mindset.</h2>
              <p>We work directly with clients to understand their environments, solve technical problems, reduce risk, and build systems that can grow with their organizations.</p>
            </div>

            <div className="team-grid">
              {team.map(person => (
                <article className="team-card" key={person.name}>
                  <div className="avatar">{person.name.split(" ").map(p => p[0]).join("")}</div>
                  <div>
                    <h3>{person.name}</h3>
                    <span className="role">{person.role}</span>
                    <p>{person.bio}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="clients" className="section alt-section">
          <div className="container">
            <div className="section-heading">
              <span className="kicker">Client experience</span>
              <h2>Long-term support and practical results.</h2>
              <p>Our work includes ongoing managed services as well as focused technical and security projects.</p>
            </div>

            <div className="case-grid">
              {cases.map(item => (
                <article className="case-card" key={item.name}>
                  <span className="case-eyebrow">{item.eyebrow}</span>
                  <h3>{item.name}</h3>
                  <p>{item.text}</p>
                  <div className="tag-row">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section why-section">
          <div className="container split-layout">
            <div>
              <span className="kicker">Why it matters</span>
              <h2>Your technology environment is interconnected.</h2>
              <p>Websites rely on DNS and cloud services. Users depend on identity platforms. Endpoints connect to SaaS applications. Cameras and physical systems run across your network. AI tools increasingly interact with sensitive business data.</p>
              <p>We treat these as parts of one technology environment instead of isolated problems.</p>
            </div>

            <div className="stack-diagram">
              <div><Globe2 /> Web & Applications</div>
              <div><Cloud /> Cloud & SaaS</div>
              <div><LockKeyhole /> Identity & Access</div>
              <div><Network /> Network & Perimeter</div>
              <div><Database /> Systems & Endpoints</div>
            </div>
          </div>
        </section>

        <section id="contact" className="section contact-section">
          <div className="container contact-grid">
            <div>
              <span className="kicker">Start a conversation</span>
              <h2>Need help with your technology environment?</h2>
              <p>Tell us what you are trying to solve. We can help with security assessments, website projects, cloud environments, managed IT, infrastructure, AI security, and ongoing support.</p>
            </div>

            <ContactForm />
          </div>
        </section>
      </main>

      <footer>
        <div className="container footer-grid">
          <div className="brand footer-brand">
            <span className="brand-mark"><BrandLogo size={24} /></span>
            <span><strong>Celestin Industries</strong><small>Technology Consulting</small></span>
          </div>
          <p>Security · Infrastructure · Cloud · AI · Web</p>
          <p>© {new Date().getFullYear()} Celestin Industries Technology Consulting. All rights reserved.</p>
        </div>
      </footer>

      {showTop && (
        <button className="back-to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <ChevronUp />
        </button>
      )}
    </div>
  );
}

export default App;
