import React from 'react'
import { render } from 'react-dom'
import {
  HashRouter as Router,
  Route,
} from 'react-router-dom'

import './style.css'

import MainList from './components/MainList'
import Nav from './components/Nav'
import Edit from './components/Edit'

const Init = () => (
  <Router>
    <div>
      <Nav />
      <Route exact path="/" component={MainList} />
      <Route path="/edit/:id" component={Edit} />
    </div>
  </Router>
)

document.addEventListener('DOMContentLoaded', () => {
  render(<Init />, document.getElementById('main'))
})
