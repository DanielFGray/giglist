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
import NewList from './components/NewList'
import View from './components/View'
import SignIn from './components/SignIn'

const Init = () => (
  <Router>
    <div>
      <Nav />
      <Route exact path="/" component={MainList} />
      <Route path="/edit/:id" component={Edit} />
      <Route path="/view/:id" component={View} />
      <Route path="/new" component={NewList} />
      <Route path="/signin" component={SignIn} />
    </div>
  </Router>
)

document.addEventListener('DOMContentLoaded', () => {
  render(<Init />, document.getElementById('main'))
})
