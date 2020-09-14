---
layout: blocks
title: Contact
date: 
page_sections:
- template: navigation-header-w-button
  block: header-2
  navigation:
  - link: "/"
    link_text: Home
  - link: "/about-me"
    link_text: About Me
  cta:
    url: "/contact"
    button_text: Contact
  logo: "/uploads/2020/09/14/favicon-1.png"
- template: simple-form
  block: simple-form
  form:
    type: simple
    method: POST
    recipient: sangstar@gmail.com
    submit_text: Message Me
    action: https://smartforms.dev/submit/5f5f20a5b81854118fd3d6ad
    fields:
    - template: text
      block: text
      type: text
      name: Name
      label: Name
      description: ''
      required: 'True'
    - template: email
      type: email
      required: 'True'
      name: Email
      label: Email
      description: ''
    - template: textarea
      type: textarea
      name: Message
      label: Message
      description: ''
      required: 'True'
  title: Message Me

---
